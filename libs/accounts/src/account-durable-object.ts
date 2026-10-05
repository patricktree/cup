import { DurableObject } from "cloudflare:workers";
import { Temporal } from "temporal-polyfill";

import {
  dispatchSegmentWorkflow,
  type SegmentWorkflowParams,
  type SynthesisWorkflowDispatcher,
  type PlaybackPosition,
  createAccountArtifactPrefix,
} from "@cup/conversion-contracts";

import { AccountArtifactWriters } from "#src/account-artifact-writers.ts";
import type {
  AccountConversionOutcome,
  AccountIdentity,
  AccountWorkflowParams,
} from "#src/account-contracts.ts";
import { AccountLifecycle, AccountLifecycleConflictError } from "#src/account-lifecycle.ts";
import type { AccountRegistry } from "#src/account-registry.ts";
import { AccountSqlite } from "#src/account-sqlite.ts";

type AccountEnvironment = {
  CONVERSION_OWNER_LIMIT: string;
  AUDIO_BUCKET: R2Bucket;
  REGISTRY: AccountRegistry;
  SYNTHESIZE_AUDIO_SEGMENT_WORKFLOW: SynthesisWorkflowDispatcher;
  PREPARE_AUDIOBOOK_WORKFLOW: {
    create(input: { id: string; params: AccountWorkflowParams }): Promise<unknown>;
    get(id: string): Promise<{
      status(): Promise<{ status: string; error?: { message: string } }>;
      restart(): Promise<void>;
    }>;
  };
};

/** Internal account RPCs; the API must authenticate and resolve ownership before calling them. */
export class AccountDurableObject extends DurableObject<AccountEnvironment> {
  private readonly sqlite: AccountSqlite;
  private readonly artifactWriters: AccountArtifactWriters;
  private readonly lifecycle: AccountLifecycle;

  constructor(context: DurableObjectState, env: AccountEnvironment) {
    super(context, env);
    this.sqlite = new AccountSqlite(context.storage);
    void context.blockConcurrencyWhile(() => this.sqlite.migrate());
    this.artifactWriters = new AccountArtifactWriters(context.storage, () =>
      this.sqlite.snapshot(),
    );
    this.lifecycle = new AccountLifecycle(context.storage, () => this.sqlite.snapshot());
  }

  migrate() {
    return this.sqlite.migrate();
  }

  initialize(identity: AccountIdentity) {
    if (this.sqlite.isErased()) throw new Error("Account was erased");
    return this.sqlite.initialize(identity);
  }

  inspect() {
    return this.sqlite.snapshot();
  }

  async startConversion(
    input: { idempotencyKey: string; sourceUrl: string },
    nowMs = Temporal.Now.instant().epochMilliseconds,
  ) {
    await this.ctx.storage.setAlarm(Temporal.Now.instant().epochMilliseconds + 60_000);
    const result = this.sqlite.startConversion(
      input,
      nowMs,
      Number(this.env.CONVERSION_OWNER_LIMIT),
    );
    if (result.result !== "exhausted") await this.reconcileDispatch();
    return result;
  }

  settleConversion(
    conversionId: string,
    outcome: AccountConversionOutcome,
    nowMs = Temporal.Now.instant().epochMilliseconds,
    executionEpoch?: number,
  ) {
    this.sqlite.settleConversion(conversionId, outcome, nowMs, executionEpoch);
  }

  reserveAudioSegment(
    conversionId: string,
    sequence: number,
    characters: number,
    executionEpoch: number,
  ) {
    this.assertExecution(conversionId, executionEpoch);
    return this.sqlite.reserveAudioSegment(
      conversionId,
      sequence,
      characters,
      Temporal.Now.instant().epochMilliseconds,
    );
  }

  completeAudioSegment(
    conversionId: string,
    sequence: number,
    durationMilliseconds: number,
    executionEpoch: number,
  ) {
    this.assertExecution(conversionId, executionEpoch);
    return this.sqlite.completeAudioSegment(
      conversionId,
      sequence,
      durationMilliseconds,
      Temporal.Now.instant().epochMilliseconds,
    );
  }

  listAudioSegments(conversionId: string) {
    return this.sqlite.listAudioSegments(conversionId);
  }

  adjustAllowance(
    requestId: string,
    amount: number,
    cause: string,
    nowMs = Temporal.Now.instant().epochMilliseconds,
  ) {
    this.sqlite.adjustAllowance(requestId, amount, cause, nowMs);
  }

  inspectAccounting() {
    return this.sqlite.inspectAccounting();
  }

  history(cursor?: { createdAtMs: number; conversionId: string }) {
    return this.sqlite.history(cursor);
  }

  getConversion(conversionId: string) {
    return this.sqlite.getConversion(conversionId);
  }

  assertExecution(conversionId: string, executionEpoch: number) {
    const account = this.sqlite.snapshot();
    if (
      account.state === "deleting" ||
      (account.state === "deletion_scheduled" &&
        (account.recoveryDeadlineMs === null ||
          Temporal.Now.instant().epochMilliseconds >= account.recoveryDeadlineMs)) ||
      account.executionEpoch !== executionEpoch ||
      !(["pending", "ready"] as const).some(
        (status) => status === this.sqlite.getConversion(conversionId)?.status,
      )
    )
      throw new Error("Account execution is fenced");
  }

  requestAudioSegment(params: SegmentWorkflowParams, retry: boolean) {
    return this.ctx.blockConcurrencyWhile(async () => {
      this.assertExecution(params.conversionId, params.executionEpoch);
      if (this.sqlite.getConversion(params.conversionId)?.status !== "ready")
        throw new Error("Narration is not prepared");
      return dispatchSegmentWorkflow(this.env.SYNTHESIZE_AUDIO_SEGMENT_WORKFLOW, params, retry);
    });
  }

  releaseAudioSegment(conversionId: string, sequence: number, executionEpoch: number) {
    this.assertExecution(conversionId, executionEpoch);
    this.sqlite.releaseAudioSegment(conversionId, sequence);
  }

  getPlaybackPosition(conversionId: string) {
    return this.sqlite.getPlaybackPosition(conversionId);
  }
  savePlaybackPosition(conversionId: string, position: PlaybackPosition) {
    this.sqlite.savePlaybackPosition(conversionId, position);
  }

  retryPreparation(conversionId: string) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const conversion = this.sqlite.getConversion(conversionId);
      if (conversion?.outcome?.status !== "failed") return;
      const account = this.sqlite.snapshot();
      const workflow = this.env.PREPARE_AUDIOBOOK_WORKFLOW;
      this.sqlite.retryPreparation(conversionId);
      try {
        try {
          await workflow.create({
            id: conversionId,
            params: {
              v: 2,
              sourceUrl: conversion.sourceUrl,
              owner: { kind: "account", accountId: account.accountId },
              conversionId,
              executionEpoch: account.executionEpoch,
            },
          });
        } catch {
          // Restart also covers the brief interval between recording failure and platform termination.
          const instance = await workflow.get(conversionId);
          await instance.restart();
        }
      } catch (error) {
        this.sqlite.settleConversion(
          conversionId,
          conversion.outcome,
          Temporal.Now.instant().epochMilliseconds,
        );
        throw error;
      }
    });
  }

  override async alarm() {
    if (this.sqlite.isErased()) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    // Re-arm before external calls: abrupt termination must not lose dispatch intent.
    await this.ctx.storage.setAlarm(Temporal.Now.instant().epochMilliseconds + 60_000);
    await this.reconcileArtifactWriters();
    await this.reconcileLifecycle();
    if (this.sqlite.snapshot().state === "deleting") return;
    await this.reconcileDispatch();
    if (
      this.sqlite.snapshot().state === "active" &&
      this.lifecycle.outbox().length === 0 &&
      this.sqlite.unsettledConversions().length === 0 &&
      this.artifactWriters.writers().length === 0
    )
      await this.ctx.storage.deleteAlarm();
  }

  private async reconcileDispatch() {
    const workflow = this.env.PREPARE_AUDIOBOOK_WORKFLOW;
    const registry = this.env.REGISTRY;
    const account = this.sqlite.snapshot();
    for (const job of this.sqlite.unsettledConversions()) {
      try {
        this.assertExecution(job.conversionId, job.executionEpoch);
        if (job.state === "delivered") {
          const status = await (await workflow.get(job.conversionId)).status();
          if (status.status === "errored" || status.status === "terminated")
            this.sqlite.settleConversion(
              job.conversionId,
              {
                status: "failed",
                failureCategory: "execution-failed",
                explanation: "The conversion could not be completed.",
              },
              Temporal.Now.instant().epochMilliseconds,
              job.executionEpoch,
            );
          continue;
        }
        const conversion = this.sqlite.getConversion(job.conversionId);
        if (!conversion) throw new Error("Missing conversion dispatch target");
        await registry
          .get(registry.idFromName("registry"))
          .bindConversionOwner(job.conversionId, { kind: "account", accountId: account.accountId });
        const params: AccountWorkflowParams = {
          v: 2,
          sourceUrl: conversion.sourceUrl,
          owner: { kind: "account", accountId: account.accountId },
          conversionId: job.conversionId,
          executionEpoch: job.executionEpoch,
        };
        try {
          await workflow.create({ id: job.conversionId, params });
        } catch {
          await (await workflow.get(job.conversionId)).status();
        }
        this.sqlite.markDispatched(job.conversionId);
      } catch {
        /* Persisted intent and the alarm retry dependency failures. */
      }
    }
  }

  async reconcileArtifactWriter(writerId: string) {
    const writer = this.artifactWriters.find(writerId);
    if (!writer) return false;
    if (writer.state === "drained") return true;
    if (writer.effect !== null) {
      if (!writer.effect.startsWith("put:")) return false;
      const object = await this.env.AUDIO_BUCKET.head(writer.effect.slice(4));
      if (object?.customMetadata?.["cup-writer-id"] !== writerId) return false;
      this.artifactWriters.writerEffect(writerId, null);
    }
    this.artifactWriters.drainWriter(writerId);
    return true;
  }
  private async reconcileArtifactWriters() {
    for (const writer of this.artifactWriters.writers())
      await this.reconcileArtifactWriter(writer.writerId);
  }

  prepareArtifactWrite(writerId: string, executionEpoch: number, prefix: string, key: string) {
    this.artifactWriters.prepareWrite(writerId, executionEpoch, prefix, key);
  }

  registerArtifactWriter(writerId: string, executionEpoch: number, prefix: string) {
    this.artifactWriters.registerWriter(writerId, executionEpoch, prefix);
  }
  beginArtifactEffect(writerId: string, effect: string) {
    this.artifactWriters.writerEffect(writerId, effect);
  }
  acknowledgeArtifactEffect(writerId: string) {
    this.artifactWriters.writerEffect(writerId, null);
  }
  drainArtifactWriter(writerId: string) {
    this.artifactWriters.drainWriter(writerId);
  }

  deletionAttemptState(attemptId: string) {
    const attempt = this.lifecycle.current();
    return attempt?.attemptId === attemptId ? attempt.state : null;
  }
  deletionChallenge() {
    return this.lifecycle.challenge();
  }
  async scheduleDeletion(input: {
    challengeId: string;
    authenticatedAtSeconds: number;
    email: string;
  }) {
    await this.ctx.storage.setAlarm(Temporal.Now.instant().epochMilliseconds + 60_000);
    let attempt;
    try {
      attempt = this.lifecycle.schedule(input);
    } catch (error) {
      if (error instanceof AccountLifecycleConflictError) return { result: "conflict" } as const;
      throw error;
    }
    await this.reconcileLifecycle();
    return { result: "scheduled", attempt } as const;
  }
  async restoreAccount(challengeId: string, authenticatedAtSeconds: number) {
    await this.ctx.storage.setAlarm(Temporal.Now.instant().epochMilliseconds + 60_000);
    try {
      this.lifecycle.restore(challengeId, authenticatedAtSeconds);
    } catch (error) {
      if (error instanceof AccountLifecycleConflictError) return { result: "conflict" } as const;
      throw error;
    }
    await this.reconcileLifecycle();
    return { result: "restored", account: this.sqlite.snapshot() } as const;
  }
  private async reconcileLifecycle() {
    const registry = this.env.REGISTRY;
    for (const attempt of this.lifecycle.outbox()) {
      await registry.get(registry.idFromName("registry")).acceptDeletionAttempt(attempt);
      this.lifecycle.delivered(attempt.attemptId, attempt.state);
    }
    const attempt = this.lifecycle.current();
    if (
      attempt?.state === "scheduled" &&
      Temporal.Now.instant().epochMilliseconds >= attempt.deadlineMs
    ) {
      await registry.get(registry.idFromName("registry")).acceptDeletionAttempt(attempt);
      this.lifecycle.fence(attempt.attemptId);
    }
  }
  fenceDeletion(attemptId: string) {
    this.lifecycle.fence(attemptId);
  }
  async eraseAccount(attemptId: string) {
    if (this.sqlite.isErased()) {
      return;
    }
    const attempt = this.lifecycle.current();
    if (attempt?.attemptId !== attemptId || this.sqlite.snapshot().state !== "deleting")
      throw new Error("Account erasure is fenced");
    if (this.artifactWriters.writers().length) throw new Error("Artifact writers have not drained");
    const prefix = createAccountArtifactPrefix(attempt.accountId);
    for (;;) {
      const objects = await this.env.AUDIO_BUCKET.list({ prefix, limit: 1000 });
      if (objects.objects.length === 0) break;
      await this.env.AUDIO_BUCKET.delete(objects.objects.map((object) => object.key));
    }
    await this.env.REGISTRY.get(
      this.env.REGISTRY.idFromName("registry"),
    ).removeAccountConversionOwners(attempt.accountId);
    this.sqlite.erase();
    await this.ctx.storage.deleteAlarm();
  }

  inspectArtifactWriters() {
    return this.artifactWriters.writers();
  }
  pendingConversions() {
    return this.sqlite.pendingConversions();
  }
}
