import { and, desc, eq, lt, or } from "drizzle-orm";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { z } from "zod";

import { createConversionArtifactPrefix } from "@cup/conversion-contracts";

import {
  accountIdentitySchema,
  accountOutcomeSchema,
  startAccountConversionSchema,
} from "#src/account-contracts.ts";
import type {
  AccountConversion,
  AccountConversionOutcome,
  AccountIdentity,
  AccountSnapshot,
} from "#src/account-contracts.ts";
import { AccountDurationLedger } from "#src/account-duration-ledger.ts";
import {
  accounts,
  accountConversions,
  pendingJobs,
  accountAudioSegments,
  artifactWriters,
  creditBalances,
  creditLedger,
  creditOperations,
  deletionChallenges,
  deletionAttempts,
  accountTombstone,
} from "#src/account-sqlite-schema.ts";
import { canonicalJson } from "#src/encoding.ts";
import { RollingLimits } from "#src/rolling-limits.ts";
import { migrateAccount } from "#src/sqlite-migrations.ts";
import { requireRow } from "#src/sqlite-row.ts";
import { rateEvents } from "#src/sqlite-schema-shared.ts";

export class AccountSqlite {
  private readonly database: DrizzleSqliteDODatabase;
  private readonly limits: RollingLimits;
  private readonly duration: AccountDurationLedger;

  constructor(storage: DurableObjectStorage) {
    this.database = drizzle(storage);
    this.limits = new RollingLimits(storage);
    this.duration = new AccountDurationLedger(storage);
  }

  migrate(): Promise<void> {
    return migrateAccount(this.database);
  }

  isErased(): boolean {
    return (
      this.database.select({ id: accountTombstone.id }).from(accountTombstone).limit(1).get() !==
      undefined
    );
  }

  erase(): void {
    this.database.transaction(() => {
      for (const table of [
        artifactWriters,
        pendingJobs,
        accountAudioSegments,
        accountConversions,
        creditLedger,
        creditOperations,
        creditBalances,
        rateEvents,
        deletionChallenges,
        deletionAttempts,
        accounts,
      ])
        this.database.delete(table).run();
      this.database.insert(accountTombstone).values({ id: 1, attemptId: "" }).run();
    });
  }

  initialize(identity: AccountIdentity): AccountSnapshot {
    const input = accountIdentitySchema.parse(identity);
    return this.database.transaction(() => {
      const existing = this.readIdentity();
      if (existing !== undefined) {
        if (
          canonicalJson(input) !==
          canonicalJson({
            accountId: existing.accountId,
            subject: existing.subject,
            createdAtMs: existing.createdAtMs,
          })
        )
          throw new Error("Account initialization conflicts with its existing identity");
        return this.snapshot();
      }
      this.database
        .insert(accounts)
        .values({
          id: 1,
          accountId: input.accountId,
          subject: input.subject,
          createdAtMs: input.createdAtMs,
          state: "active",
          executionEpoch: 1,
        })
        .run();
      this.duration.initialize(input.accountId, input.createdAtMs);
      return this.snapshot();
    });
  }

  snapshot(): AccountSnapshot {
    const identity = this.readIdentity();
    if (identity === undefined) throw new Error("Account is not initialized");
    return { ...identity, balance: this.duration.balance() };
  }

  startConversion(
    input: { idempotencyKey: string; sourceUrl: string },
    nowMs: number,
    startLimit: number,
  ): {
    result: "created" | "replayed" | "exhausted" | "rate-limited";
    conversion?: AccountConversion;
    retryAfter?: number;
  } {
    z.number().int().nonnegative().safe().parse(nowMs);
    const request = startAccountConversionSchema.parse(input);
    const fingerprint = canonicalJson({ sourceUrl: request.sourceUrl });
    return this.database.transaction(() => {
      const account = this.requireActive();
      const existing = this.database
        .select({
          conversionId: accountConversions.conversionId,
          idempotencyKey: accountConversions.idempotencyKey,
          sourceUrl: accountConversions.sourceUrl,
          createdAtMs: accountConversions.createdAtMs,
          status: accountConversions.status,
          fingerprint: accountConversions.fingerprint,
        })
        .from(accountConversions)
        .where(eq(accountConversions.idempotencyKey, request.idempotencyKey))
        .get();
      if (existing !== undefined) {
        if (existing.fingerprint !== fingerprint)
          throw new Error("Conversion idempotency conflict");
        const { fingerprint: _fingerprint, ...conversion } = existing;
        return { result: "replayed", conversion };
      }
      if (account.balance.available < 1) return { result: "exhausted" };
      const retryAfter = this.limits.consume("account-conversion", startLimit, 60_000, nowMs);
      if (retryAfter) return { result: "rate-limited", retryAfter };
      const conversionId = crypto.randomUUID();
      this.database
        .insert(accountConversions)
        .values({
          conversionId,
          idempotencyKey: request.idempotencyKey,
          sourceUrl: request.sourceUrl,
          fingerprint,
          createdAtMs: nowMs,
          status: "pending",
        })
        .run();
      this.database
        .insert(pendingJobs)
        .values({
          jobId: `conversion:${conversionId}`,
          conversionId,
          executionEpoch: account.executionEpoch,
          state: "pending",
        })
        .run();
      return {
        result: "created",
        conversion: { conversionId, ...request, createdAtMs: nowMs, status: "pending" },
      };
    });
  }

  reserveAudioSegment(conversionId: string, sequence: number, characters: number, nowMs: number) {
    return this.duration.reserve(conversionId, sequence, characters, nowMs);
  }

  completeAudioSegment(
    conversionId: string,
    sequence: number,
    durationMilliseconds: number,
    nowMs: number,
  ) {
    return this.duration.complete(conversionId, sequence, durationMilliseconds, nowMs);
  }

  listAudioSegments(conversionId: string) {
    return this.duration.segments(conversionId);
  }

  settleConversion(
    conversionId: string,
    outcome: AccountConversionOutcome,
    nowMs: number,
    executionEpoch?: number,
  ): void {
    z.number().int().nonnegative().safe().parse(nowMs);
    z.uuidv4().parse(conversionId);
    const parsed = accountOutcomeSchema.parse(outcome);
    const fingerprint = canonicalJson(parsed);
    this.database.transaction(() => {
      const account = this.snapshot();
      if (executionEpoch !== undefined && account.executionEpoch !== executionEpoch)
        throw new Error("Account execution epoch mismatch");
      const deadline = requireRow(
        this.database
          .select({ deadline: accounts.recoveryDeadlineMs })
          .from(accounts)
          .where(eq(accounts.id, 1))
          .get(),
      ).deadline;
      if (
        account.state === "deleting" ||
        (account.state === "deletion_scheduled" && (deadline === null || nowMs >= deadline))
      )
        throw new Error("Account blocks conversion settlement");
      const conversion = this.database
        .select({ status: accountConversions.status, outcome: accountConversions.outcomeJson })
        .from(accountConversions)
        .where(eq(accountConversions.conversionId, conversionId))
        .get();
      if (conversion === undefined) throw new Error("Account conversion does not exist");
      if (conversion.status !== "pending") {
        if (conversion.outcome !== fingerprint)
          throw new Error("Conflicting conversion settlement");
        return;
      }
      if (
        parsed.status === "ready" &&
        !parsed.audiobookReference.key.startsWith(
          createConversionArtifactPrefix(conversionId, {
            kind: "account",
            accountId: account.accountId,
          }),
        )
      )
        throw new Error("Private audiobook reference is outside its conversion prefix");
      this.database
        .update(accountConversions)
        .set({ status: parsed.status, outcomeJson: fingerprint, completedAtMs: nowMs })
        .where(eq(accountConversions.conversionId, conversionId))
        .run();
      this.duration.releaseReservations(conversionId, nowMs);
      this.database
        .update(pendingJobs)
        .set({ state: "delivered" })
        .where(eq(pendingJobs.conversionId, conversionId))
        .run();
    });
  }

  adjustAllowance(requestId: string, amount: number, cause: string, nowMs: number): void {
    this.requireActive();
    this.duration.adjustAllowance(requestId, amount, cause, nowMs);
  }

  inspectAccounting() {
    return this.duration.inspectAccounting();
  }

  unsettledConversions(): {
    conversionId: string;
    executionEpoch: number;
    state: "pending" | "delivered";
  }[] {
    return this.database
      .select({
        conversionId: pendingJobs.conversionId,
        executionEpoch: pendingJobs.executionEpoch,
        state: pendingJobs.state,
      })
      .from(pendingJobs)
      .innerJoin(accountConversions, eq(pendingJobs.conversionId, accountConversions.conversionId))
      .where(eq(accountConversions.status, "pending"))
      .all();
  }

  pendingConversions(): { conversionId: string; executionEpoch: number }[] {
    return this.database
      .select({
        conversionId: pendingJobs.conversionId,
        executionEpoch: pendingJobs.executionEpoch,
      })
      .from(pendingJobs)
      .where(eq(pendingJobs.state, "pending"))
      .all();
  }

  history(cursor?: { createdAtMs: number; conversionId: string }) {
    const rows = this.database
      .select({
        conversionId: accountConversions.conversionId,
        createdAtMs: accountConversions.createdAtMs,
      })
      .from(accountConversions)
      .where(
        cursor
          ? or(
              lt(accountConversions.createdAtMs, cursor.createdAtMs),
              and(
                eq(accountConversions.createdAtMs, cursor.createdAtMs),
                lt(accountConversions.conversionId, cursor.conversionId),
              ),
            )
          : undefined,
      )
      .orderBy(desc(accountConversions.createdAtMs), desc(accountConversions.conversionId))
      .limit(51)
      .all();
    const items = rows.slice(0, 50).map((row) => this.getConversion(row.conversionId));
    const last = rows[49];
    return {
      items,
      nextCursor: rows.length > 50 && last ? `${last.createdAtMs}:${last.conversionId}` : null,
    };
  }

  getConversion(conversionId: string):
    | (AccountConversion & {
        outcome: AccountConversionOutcome | null;
        completedAtMs: number | null;
      })
    | undefined {
    const row = this.database
      .select({
        conversionId: accountConversions.conversionId,
        idempotencyKey: accountConversions.idempotencyKey,
        sourceUrl: accountConversions.sourceUrl,
        createdAtMs: accountConversions.createdAtMs,
        status: accountConversions.status,
        completedAtMs: accountConversions.completedAtMs,
        outcomeJson: accountConversions.outcomeJson,
      })
      .from(accountConversions)
      .where(eq(accountConversions.conversionId, conversionId))
      .get();
    if (!row) return undefined;
    const { outcomeJson, ...conversion } = row;
    return {
      ...conversion,
      outcome: outcomeJson === null ? null : accountOutcomeSchema.parse(JSON.parse(outcomeJson)),
    };
  }

  markDispatched(conversionId: string): void {
    this.database
      .update(pendingJobs)
      .set({ state: "delivered" })
      .where(eq(pendingJobs.conversionId, conversionId))
      .run();
  }

  private readIdentity(): Omit<AccountSnapshot, "balance"> | undefined {
    return this.database
      .select({
        accountId: accounts.accountId,
        subject: accounts.subject,
        createdAtMs: accounts.createdAtMs,
        state: accounts.state,
        executionEpoch: accounts.executionEpoch,
        recoveryDeadlineMs: accounts.recoveryDeadlineMs,
      })
      .from(accounts)
      .where(eq(accounts.id, 1))
      .get();
  }

  private requireActive(): AccountSnapshot {
    const account = this.snapshot();
    if (account.state !== "active") throw new Error("Account is not active");
    return account;
  }
}
