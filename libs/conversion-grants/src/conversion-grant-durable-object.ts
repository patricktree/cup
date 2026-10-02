import { DurableObject } from "cloudflare:workers";

import { createConversionArtifactPrefix } from "@cup/conversion-contracts";
import {
  ConversionPhase,
  type ConversionFailureCategory,
  type AudiobookReference,
  type ConversionMeasurements,
} from "@cup/conversion-contracts";
import { estimateAudioDuration } from "@cup/conversion-contracts/duration-accounting";

import { canonicalJson, encodeBase64Url } from "#src/encoding.ts";
import type {
  GrantConversions,
  GrantSnapshot,
  OperatorGrantSnapshot,
} from "#src/grant-contracts.ts";
import type {
  ExchangeCredentialResult,
  GrantConversion,
  GrantRegistrySnapshot,
  GrantRecord,
  PendingConversion,
  StartGrantConversionResult,
  TerminalOutcome,
  ValidateSessionResult,
} from "#src/grant-model.ts";
import {
  createGrantConversions,
  createGrantRegistrySnapshot,
  createGrantSnapshot,
  createOperatorGrantSnapshot,
  deriveGrantState,
  deriveDurationBalance,
  GRANT_SCHEMA_VERSION,
  DEFAULT_ALLOWANCE_MILLISECONDS,
  RECONCILIATION_CUTOFF_MS,
} from "#src/grant-model.ts";
import type { GrantRegistry } from "#src/grant-registry.ts";
import { signSession, verifyRootCredential, verifySession } from "#src/grant-session.ts";
import { ConversionGrantSqlite } from "#src/grant-sqlite.ts";
import { nowMilliseconds } from "#src/time.ts";

const START_RATE_WINDOW_MS = 60_000;
const RECONCILIATION_RETRY_MS = 60_000;
const MAINTENANCE_RETRY_MS = 60 * 60 * 1_000;
const CLEANUP_RETRY_CUTOFF_MS = 7 * 24 * 60 * 60 * 1_000;

type ConversionGrantEnvironment = {
  CONVERSION_OWNER_LIMIT: string;
  CREATE_AUDIOBOOK_FROM_URL_WORKFLOW: Workflow<{ sourceUrl: string; grantId: string }>;
  AUDIO_BUCKET: R2Bucket;
  REGISTRY: GrantRegistry;
};

export class ConversionGrantDurableObject extends DurableObject<ConversionGrantEnvironment> {
  private readonly sqlite: ConversionGrantSqlite;

  constructor(context: DurableObjectState, env: ConversionGrantEnvironment) {
    super(context, env);
    this.sqlite = new ConversionGrantSqlite(context.storage);
    void context.blockConcurrencyWhile(() => this.sqlite.applyMigrations());
  }

  async initialize(
    grantId: string,
    createdAtMs: number,
    expiresAtMs: number,
  ): Promise<GrantRegistrySnapshot> {
    return this.ctx.storage.transaction(async () => {
      const existing = await this.sqlite.load();
      if (existing !== undefined) {
        if (
          existing.grantId !== grantId ||
          existing.createdAtMs !== createdAtMs ||
          existing.expiresAtMs !== expiresAtMs
        ) {
          throw new Error("Conversion grant initialization conflicts with authoritative identity");
        }
        return createGrantRegistrySnapshot(existing);
      }
      const record: GrantRecord = {
        allowanceMilliseconds: DEFAULT_ALLOWANCE_MILLISECONDS,
        grantId,
        createdAtMs,
        expiresAtMs,
        sessionSigningKey: encodeBase64Url(crypto.getRandomValues(new Uint8Array(32))),
        signingKeyGeneration: 1,
        registrySnapshotRevision: 1,
        registryConfirmedSnapshotRevision: 0,
        startAttempts: [],
        conversions: [],
        segmentUsage: [],
      };
      await this.sqlite.save(record);
      return createGrantRegistrySnapshot(record);
    });
  }

  async installCredentialVerifier(
    verifier: string,
    issuedAtMs: number,
  ): Promise<"installed" | "already-issued"> {
    return this.ctx.storage.transaction(async () => {
      const record = await this.sqlite.requireRecord();
      if (record.credentialVerifier !== undefined) return "already-issued";
      record.credentialVerifier = verifier;
      record.credentialIssuedAtMs = issuedAtMs;
      await this.sqlite.save(record);
      return "installed";
    });
  }

  async exchangeCredential(
    credential: string,
    nowMs = nowMilliseconds(),
  ): Promise<ExchangeCredentialResult> {
    const record = await this.sqlite.requireRecord();
    if (record.credentialVerifier === undefined) return { result: "invalid-credential" };
    if (!(await verifyRootCredential(credential, record.credentialVerifier)))
      return { result: "invalid-credential" };
    if (record.revokedAtMs !== undefined) return { result: "grant-revoked" };
    return {
      result: "created",
      sessionToken: await signSession(record, nowMs),
      snapshot: createGrantSnapshot(record, nowMs),
    };
  }

  async validateSession(token: string, nowMs = nowMilliseconds()): Promise<ValidateSessionResult> {
    const record = await this.sqlite.requireRecord();
    return (await verifySession(record, token, nowMs))
      ? { result: "valid", snapshot: createGrantSnapshot(record, nowMs) }
      : { result: "invalid" };
  }

  async inspect(nowMs = nowMilliseconds()): Promise<GrantSnapshot> {
    return createGrantSnapshot(await this.sqlite.requireRecord(), nowMs);
  }

  async listConversions(): Promise<GrantConversions> {
    return createGrantConversions(await this.sqlite.requireRecord());
  }

  async inspectOperator(nowMs = nowMilliseconds()): Promise<OperatorGrantSnapshot> {
    return createOperatorGrantSnapshot(await this.sqlite.requireRecord(), nowMs);
  }

  async getConversion(conversionId: string): Promise<GrantConversion | undefined> {
    return (await this.sqlite.requireRecord()).conversions.find(
      (conversion) => conversion.conversionId === conversionId,
    );
  }

  async getReadyAudiobookReference(conversionId: string): Promise<AudiobookReference | undefined> {
    const conversion = await this.getConversion(conversionId);
    return conversion?.status === "ready" ? conversion.audiobookReference : undefined;
  }

  async startConversion(
    sourceUrl: string,
    idempotencyKey: string,
    nowMs = nowMilliseconds(),
  ): Promise<StartGrantConversionResult> {
    return this.ctx.storage.transaction(async () => {
      const record = await this.sqlite.requireRecord();
      const existing = record.conversions.find(
        (conversion) => conversion.idempotencyKey === idempotencyKey,
      );
      if (existing !== undefined) {
        if (existing.sourceUrl !== sourceUrl) return { result: "idempotency-conflict" };
        return {
          result: "replayed",
          conversion: existing,
          duration: deriveDurationBalance(record),
          registrySnapshot: createGrantRegistrySnapshot(record),
        };
      }

      const windowStart = nowMs - START_RATE_WINDOW_MS;
      record.startAttempts = record.startAttempts.filter((attempt) => attempt > windowStart);
      const startLimit = Number(this.env.CONVERSION_OWNER_LIMIT);

      if (!Number.isSafeInteger(startLimit) || startLimit <= 0)
        throw new Error("Invalid conversion rate limit");

      if (record.startAttempts.length >= startLimit) {
        await this.sqlite.save(record);
        const retryAt = record.startAttempts[0]! + START_RATE_WINDOW_MS;
        return {
          result: "rate-limited",
          retryAfterSeconds: Math.max(1, Math.ceil((retryAt - nowMs) / 1_000)),
        };
      }

      record.startAttempts.push(nowMs);
      const state = deriveGrantState(record, nowMs);
      if (state !== "open") {
        await this.sqlite.save(record);
        return { result: state };
      }
      const conversion: PendingConversion = {
        conversionId: crypto.randomUUID(),
        idempotencyKey,
        sourceUrl,
        acceptedAtMs: nowMs,
        status: "pending",
        lastStartedPhase: ConversionPhase.CONVERSION_START,
      };
      record.conversions.push(conversion);
      record.registrySnapshotRevision += 1;
      await this.sqlite.save(record);
      await this.ctx.storage.setAlarm(nowMs + RECONCILIATION_RETRY_MS);
      return {
        result: "created",
        conversion,
        duration: deriveDurationBalance(record),
        registrySnapshot: createGrantRegistrySnapshot(record),
      };
    });
  }

  async reserveAudioSegment(
    conversionId: string,
    sequence: number,
    narrationTextCharacters: number,
  ) {
    if (!Number.isSafeInteger(sequence) || sequence < 0)
      throw new Error("Invalid segment sequence");
    return this.ctx.storage.transaction(async () => {
      const record = await this.sqlite.requireRecord();
      if (!record.conversions.some((conversion) => conversion.conversionId === conversionId))
        throw new Error("Conversion does not exist");
      const existing = record.segmentUsage.find(
        (segment) => segment.conversionId === conversionId && segment.sequence === sequence,
      );
      if (existing && existing.narrationTextCharacters !== narrationTextCharacters)
        throw new Error("Segment reservation conflicts with synthesis identity");
      if (existing?.state === "settled") return { result: "settled" as const };
      if (existing?.state === "reserved") return { result: "reserved" as const };
      const state = deriveGrantState(record, nowMilliseconds());
      if (state !== "open") return { result: state };
      const estimatedMilliseconds = estimateAudioDuration(narrationTextCharacters);
      if (estimatedMilliseconds > deriveDurationBalance(record).availableMilliseconds)
        return { result: "insufficient-duration" as const };
      const reservation = {
        conversionId,
        sequence,
        narrationTextCharacters,
        estimatedMilliseconds,
        state: "reserved" as const,
        actualMilliseconds: 0,
        chargedMilliseconds: 0,
      };
      if (existing) Object.assign(existing, reservation);
      else record.segmentUsage.push(reservation);
      record.registrySnapshotRevision += 1;
      await this.sqlite.save(record);
      await this.ctx.storage.setAlarm(nowMilliseconds() + RECONCILIATION_RETRY_MS);
      return { result: "reserved" as const };
    });
  }

  async completeAudioSegment(conversionId: string, sequence: number, durationMilliseconds: number) {
    if (!Number.isFinite(durationMilliseconds) || durationMilliseconds <= 0)
      throw new Error("Generated duration must be positive and finite");
    const actualMilliseconds = Math.ceil(durationMilliseconds);
    if (!Number.isSafeInteger(actualMilliseconds))
      throw new Error("Generated duration exceeds supported precision");
    return this.ctx.storage.transaction(async () => {
      const record = await this.sqlite.requireRecord();
      const segment = record.segmentUsage.find(
        (item) => item.conversionId === conversionId && item.sequence === sequence,
      );
      if (segment === undefined) throw new Error("Audio segment has no duration reservation");
      if (segment.state === "settled") {
        if (segment.actualMilliseconds !== actualMilliseconds)
          throw new Error("Conflicting audio duration settlement");
        return { result: "replayed" as const };
      }
      if (segment.state !== "reserved") throw new Error("Audio segment reservation was released");
      const balance = deriveDurationBalance(record);
      segment.state = "settled";
      segment.actualMilliseconds = actualMilliseconds;
      segment.chargedMilliseconds = Math.min(
        actualMilliseconds,
        Math.max(0, record.allowanceMilliseconds - balance.spentMilliseconds),
      );
      record.registrySnapshotRevision += 1;
      await this.sqlite.save(record);
      await this.ctx.storage.setAlarm(nowMilliseconds() + RECONCILIATION_RETRY_MS);
      return { result: "recorded" as const };
    });
  }

  async retainHistoricalAudioSegment(
    conversionId: string,
    sequence: number,
    characters: number,
    durationMilliseconds: number,
  ): Promise<void> {
    await this.ctx.storage.transaction(async () => {
      const record = await this.sqlite.requireRecord();
      if (!record.conversions.some((conversion) => conversion.conversionId === conversionId))
        throw new Error("Conversion does not exist");
      if (
        record.segmentUsage.some(
          (segment) => segment.conversionId === conversionId && segment.sequence === sequence,
        )
      )
        return;
      record.segmentUsage.push({
        conversionId,
        sequence,
        narrationTextCharacters: characters,
        estimatedMilliseconds: estimateAudioDuration(characters),
        state: "settled",
        actualMilliseconds: Math.ceil(durationMilliseconds),
        chargedMilliseconds: 0,
      });
      await this.sqlite.save(record);
    });
  }

  async listAudioSegments(conversionId: string) {
    return (await this.sqlite.requireRecord()).segmentUsage
      .filter((segment) => segment.conversionId === conversionId && segment.state === "settled")
      .toSorted((left, right) => left.sequence - right.sequence);
  }

  async markWorkflowStarted(conversionId: string, nowMs = nowMilliseconds()): Promise<void> {
    await this.ctx.storage.transaction(async () => {
      const record = await this.sqlite.requireRecord();
      const conversion = record.conversions.find((item) => item.conversionId === conversionId);
      if (conversion === undefined) throw new Error("Conversion does not exist");
      conversion.workflowStartedAtMs ??= nowMs;
      await this.sqlite.save(record);
    });
  }

  async recordPhaseStarted(conversionId: string, phase: ConversionPhase): Promise<void> {
    await this.ctx.storage.transaction(async () => {
      const record = await this.sqlite.requireRecord();
      const conversion = record.conversions.find((item) => item.conversionId === conversionId);
      if (conversion === undefined) throw new Error("Conversion does not exist");
      if (conversion.status !== "pending")
        throw new Error("Only a pending conversion can start a phase");
      conversion.lastStartedPhase = phase;
      await this.sqlite.save(record);
    });
  }

  async recordReady(
    conversionId: string,
    input: {
      title: string;
      audiobookReference: AudiobookReference;
      measurements?: ConversionMeasurements;
      providerUsage?: Record<string, unknown>;
      completedAtMs?: number;
    },
  ): Promise<"recorded" | "replayed"> {
    return this.recordTerminal(conversionId, {
      status: "ready",
      completedAtMs: input.completedAtMs ?? nowMilliseconds(),
      title: input.title,
      audiobookReference: input.audiobookReference,
      ...(input.measurements === undefined ? {} : { measurements: input.measurements }),
      ...(input.providerUsage === undefined ? {} : { providerUsage: input.providerUsage }),
    });
  }

  async recordFailed(
    conversionId: string,
    input: {
      title?: string;
      failureCategory: ConversionFailureCategory;
      explanation: string;
      diagnosticReference?: string;
      cleanupState?: "pending" | "complete" | "cleanup_failed";
      completedAtMs?: number;
    },
  ): Promise<"recorded" | "replayed"> {
    return this.recordTerminal(conversionId, {
      status: "failed",
      completedAtMs: input.completedAtMs ?? nowMilliseconds(),
      ...(input.title === undefined ? {} : { title: input.title }),
      failureCategory: input.failureCategory,
      explanation: input.explanation,
      ...(input.diagnosticReference === undefined
        ? {}
        : { diagnosticReference: input.diagnosticReference }),
      ...(input.cleanupState === undefined ? {} : { cleanupState: input.cleanupState }),
    });
  }

  async setDurationAllowance(allowanceMilliseconds: number, nowMs = nowMilliseconds()) {
    if (!Number.isSafeInteger(allowanceMilliseconds) || allowanceMilliseconds < 1)
      throw new Error("Duration allowance must be a positive safe integer");
    return this.ctx.storage.transaction(async () => {
      const record = await this.sqlite.requireRecord();
      const duration = deriveDurationBalance(record);
      const changed = record.allowanceMilliseconds !== allowanceMilliseconds;
      if (
        changed &&
        allowanceMilliseconds < duration.reservedMilliseconds + duration.spentMilliseconds
      )
        return { result: "below-used-duration" as const };
      if (changed) {
        record.allowanceMilliseconds = allowanceMilliseconds;
        record.registrySnapshotRevision += 1;
        await this.sqlite.save(record);
        await this.ctx.storage.setAlarm(nowMs + RECONCILIATION_RETRY_MS);
      }
      return {
        result: "updated" as const,
        changed,
        snapshot: createGrantSnapshot(record, nowMs),
        registrySnapshot: createGrantRegistrySnapshot(record),
      };
    });
  }

  async revoke(nowMs = nowMilliseconds()): Promise<{
    changed: boolean;
    snapshot: GrantSnapshot;
    registrySnapshot: GrantRegistrySnapshot;
  }> {
    return this.ctx.storage.transaction(async () => {
      const record = await this.sqlite.requireRecord();
      const changed = record.revokedAtMs === undefined;
      if (changed) {
        record.revokedAtMs = nowMs;
        record.registrySnapshotRevision += 1;
        await this.sqlite.save(record);
      }
      return {
        changed,
        snapshot: createGrantSnapshot(record, nowMs),
        registrySnapshot: createGrantRegistrySnapshot(record),
      };
    });
  }

  async invalidateSessions(nowMs = nowMilliseconds()): Promise<{
    invalidatedAtMs: number;
    snapshot: GrantSnapshot;
    registrySnapshot: GrantRegistrySnapshot;
  }> {
    return this.ctx.storage.transaction(async () => {
      const record = await this.sqlite.requireRecord();
      record.revokedAtMs ??= nowMs;
      record.sessionSigningKey = encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
      record.signingKeyGeneration += 1;
      record.registrySnapshotRevision += 1;
      await this.sqlite.save(record);
      return {
        invalidatedAtMs: nowMs,
        snapshot: createGrantSnapshot(record, nowMs),
        registrySnapshot: createGrantRegistrySnapshot(record),
      };
    });
  }

  async confirmRegistrySnapshot(revision: number): Promise<void> {
    await this.ctx.storage.transaction(async () => {
      const record = await this.sqlite.requireRecord();
      record.registryConfirmedSnapshotRevision = Math.max(
        record.registryConfirmedSnapshotRevision,
        revision,
      );
      await this.sqlite.save(record);
    });
  }

  async migrate(): Promise<number> {
    await this.sqlite.applyMigrations();
    return GRANT_SCHEMA_VERSION;
  }

  private async recordTerminal(
    conversionId: string,
    terminal: TerminalOutcome,
  ): Promise<"recorded" | "replayed"> {
    return this.ctx.storage.transaction(async () => {
      const record = await this.sqlite.requireRecord();
      const index = record.conversions.findIndex((item) => item.conversionId === conversionId);
      const existing = record.conversions[index];
      if (existing === undefined) throw new Error("Conversion does not exist");
      if (existing.status !== "pending") {
        const candidate = { ...existing, ...terminal };
        if (canonicalJson(existing) === canonicalJson(candidate)) return "replayed";
        const isRecoveredWorkflow = existing.status === "failed" && terminal.status === "ready";
        if (!isRecoveredWorkflow)
          throw new Error("A terminal conversion outcome cannot be changed");
      }
      const identity = {
        conversionId: existing.conversionId,
        idempotencyKey: existing.idempotencyKey,
        sourceUrl: existing.sourceUrl,
        acceptedAtMs: existing.acceptedAtMs,
        lastStartedPhase: existing.lastStartedPhase,
        ...(existing.workflowStartedAtMs === undefined
          ? {}
          : { workflowStartedAtMs: existing.workflowStartedAtMs }),
      };
      record.conversions[index] =
        terminal.status === "ready" ? { ...identity, ...terminal } : { ...identity, ...terminal };
      for (const segment of record.segmentUsage) {
        if (segment.conversionId === conversionId && segment.state === "reserved")
          segment.state = "released";
      }
      record.registrySnapshotRevision += 1;
      await this.sqlite.save(record);
      await this.ctx.storage.setAlarm(nowMilliseconds() + RECONCILIATION_RETRY_MS);
      return "recorded";
    });
  }

  /** Reconciles stable Workflow startup, the Registry snapshot, and failed artifacts. */
  override async alarm(): Promise<void> {
    let record = await this.sqlite.requireRecord();
    for (const conversion of record.conversions) {
      if (
        conversion.status !== "pending" ||
        conversion.workflowStartedAtMs !== undefined ||
        nowMilliseconds() - conversion.acceptedAtMs >= RECONCILIATION_CUTOFF_MS
      ) {
        continue;
      }
      try {
        const instance = await this.env.CREATE_AUDIOBOOK_FROM_URL_WORKFLOW.get(
          conversion.conversionId,
        );
        await instance.status();
        await this.markWorkflowStarted(conversion.conversionId);
      } catch {
        try {
          await this.env.CREATE_AUDIOBOOK_FROM_URL_WORKFLOW.create({
            id: conversion.conversionId,
            params: { sourceUrl: conversion.sourceUrl, grantId: record.grantId },
          });
          await this.markWorkflowStarted(conversion.conversionId);
        } catch {
          // The same stable identity remains reserved when the platform result is ambiguous.
        }
      }
    }

    record = await this.sqlite.requireRecord();
    if (record.registryConfirmedSnapshotRevision < record.registrySnapshotRevision) {
      try {
        const registry = this.env.REGISTRY.get(this.env.REGISTRY.idFromName("registry"));
        await registry.applyGrantRegistrySnapshot(createGrantRegistrySnapshot(record));
        await this.confirmRegistrySnapshot(record.registrySnapshotRevision);
      } catch {
        // The Registry snapshot is derived and safe to retry indefinitely.
      }
    }

    await this.reconcileGeneration(record);
    record = await this.sqlite.requireRecord();
    await this.cleanupFailedArtifacts(record);

    record = await this.sqlite.requireRecord();
    const hasDueMaintenance =
      record.registryConfirmedSnapshotRevision < record.registrySnapshotRevision ||
      record.segmentUsage.some((segment) => segment.state === "reserved") ||
      record.conversions.some(
        (conversion) =>
          (conversion.status === "pending" &&
            conversion.workflowStartedAtMs === undefined &&
            nowMilliseconds() - conversion.acceptedAtMs < RECONCILIATION_CUTOFF_MS) ||
          (conversion.status === "failed" && conversion.cleanupState === "pending"),
      );
    if (hasDueMaintenance) {
      await this.ctx.storage.setAlarm(nowMilliseconds() + MAINTENANCE_RETRY_MS);
    }
  }

  private async reconcileGeneration(record: GrantRecord): Promise<void> {
    for (const conversion of record.conversions) {
      if (conversion.status !== "pending") continue;
      try {
        const instance = await this.env.CREATE_AUDIOBOOK_FROM_URL_WORKFLOW.get(
          conversion.conversionId,
        );
        const status = await instance.status();
        if (status.status === "errored" || status.status === "terminated") {
          await this.recordFailed(conversion.conversionId, {
            failureCategory: "workflow-platform",
            explanation: "Generation stopped. Unfinished segments did not consume allowance.",
            cleanupState: "pending",
          });
        }
      } catch {
        // An ambiguous platform result must not release reservations for work that might still be running.
      }
    }
  }

  private async cleanupFailedArtifacts(record: GrantRecord): Promise<void> {
    for (const conversion of record.conversions) {
      if (conversion.status !== "failed" || conversion.cleanupState !== "pending") continue;
      if (
        record.segmentUsage.some(
          (segment) =>
            segment.conversionId === conversion.conversionId && segment.state === "settled",
        )
      ) {
        await this.setCleanupState(conversion.conversionId, "complete");
        continue;
      }
      try {
        let cursor: string | undefined;
        do {
          const page = await this.env.AUDIO_BUCKET.list({
            prefix: createConversionArtifactPrefix(conversion.conversionId),
            ...(cursor === undefined ? {} : { cursor }),
          });
          if (page.objects.length > 0) {
            await this.env.AUDIO_BUCKET.delete(page.objects.map((object) => object.key));
          }
          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor !== undefined);
        await this.setCleanupState(conversion.conversionId, "complete");
      } catch {
        if (nowMilliseconds() - conversion.completedAtMs >= CLEANUP_RETRY_CUTOFF_MS) {
          await this.setCleanupState(conversion.conversionId, "cleanup_failed");
        }
      }
    }
  }

  private async setCleanupState(
    conversionId: string,
    cleanupState: "complete" | "cleanup_failed",
  ): Promise<void> {
    await this.ctx.storage.transaction(async () => {
      const record = await this.sqlite.requireRecord();
      const conversion = record.conversions.find(
        (candidate) => candidate.conversionId === conversionId,
      );
      if (conversion?.status !== "failed") {
        throw new Error("Failed conversion cleanup state is unavailable");
      }
      conversion.cleanupState = cleanupState;
      await this.sqlite.save(record);
    });
  }
}
