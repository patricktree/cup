import { and, desc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";

import {
  ConversionPhase,
  conversionPhaseSchema,
  playbackPositionSchema,
  type PlaybackPosition,
  createConversionArtifactPrefix,
  derivePreparedConversionStatus,
} from "@cup/conversion-contracts";
import { DurationLedger } from "@cup/duration-ledger";
import { RollingLimits } from "@cup/rolling-limits";

import {
  ACCOUNT_USAGE_PROJECTION_SCHEMA_VERSION,
  accountIdentitySchema,
  accountOutcomeSchema,
  startAccountConversionSchema,
} from "#src/domain/account-contracts.ts";
import type {
  AccountAccountingInspection,
  AccountConversion,
  AccountConversionOutcome,
  AccountHistoryPage,
  AccountIdentity,
  AccountSnapshot,
  AccountUsageProjection,
} from "#src/domain/account-contracts.ts";
import { canonicalJson } from "#src/encoding.ts";
import {
  accountPlaybackPositions,
  accounts,
  accountConversions,
  pendingJobs,
  audioSegments,
  artifactWriters,
  creditBalances,
  creditLedger,
  creditOperations,
  deletionChallenges,
  deletionAttempts,
  accountTombstone,
} from "#src/storage/account-sqlite-schema.ts";
import { rateEvents } from "#src/storage/rate-limit-schema.ts";
import { migrateAccount } from "#src/storage/sqlite-migrations.ts";
import { requireRow } from "#src/storage/sqlite-row.ts";

const WELCOME_ALLOWANCE_MILLISECONDS = 30 * 60 * 1_000;

export class AccountSqlite {
  private readonly database: DrizzleSqliteDODatabase;
  private readonly limits: RollingLimits;
  private readonly duration: DurationLedger;

  constructor(storage: DurableObjectStorage) {
    this.database = drizzle(storage);
    this.limits = new RollingLimits(storage);
    this.duration = new DurationLedger(storage, audioSegments);
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
        accountPlaybackPositions,
        artifactWriters,
        pendingJobs,
        audioSegments,
        accountConversions,
        creditLedger,
        creditOperations,
        creditBalances,
        rateEvents,
        deletionChallenges,
        deletionAttempts,
        accounts,
      ]) {
        this.database.delete(table).run();
      }
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
        ) {
          throw new Error("Account initialization conflicts with its existing identity");
        }
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
      this.duration.initialize(
        `welcome:${input.accountId}:v1`,
        WELCOME_ALLOWANCE_MILLISECONDS,
        "welcome-v1",
        input.createdAtMs,
      );
      return this.snapshot();
    });
  }

  snapshot(): AccountSnapshot {
    const identity = this.readIdentity();
    if (identity === undefined) {
      throw new Error("Account is not initialized");
    }
    return { ...identity, balance: { unit: "audio-millisecond", ...this.duration.balance() } };
  }

  usageProjection(): AccountUsageProjection {
    const { accountId } = this.snapshot();
    const totals = this.duration.totals();
    return {
      accountId,
      revision: this.duration.revision(),
      allowanceMilliseconds: totals.allowanceMilliseconds,
      reservedMilliseconds: totals.reservedMilliseconds,
      spentMilliseconds: totals.spentMilliseconds,
      schemaVersion: ACCOUNT_USAGE_PROJECTION_SCHEMA_VERSION,
    };
  }

  hasUnconfirmedUsage(): boolean {
    const confirmed = this.database
      .select({ revision: accounts.registryConfirmedRevision })
      .from(accounts)
      .where(eq(accounts.id, 1))
      .get();
    return confirmed !== undefined && confirmed.revision < this.duration.revision();
  }

  /** Confirmations can arrive out of order, so the confirmed revision only moves forward. */
  confirmRegistryUsage(revision: number): void {
    z.number().int().nonnegative().safe().parse(revision);
    this.database
      .update(accounts)
      .set({
        registryConfirmedRevision: sql`max(${accounts.registryConfirmedRevision}, ${revision})`,
      })
      .where(eq(accounts.id, 1))
      .run();
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
    return this.database.transaction(() => {
      const account = this.requireActive();
      const existing = this.database
        .select({
          conversionId: accountConversions.conversionId,
          idempotencyKey: accountConversions.idempotencyKey,
          sourceUrl: accountConversions.sourceUrl,
          createdAtMs: accountConversions.createdAtMs,
          status: accountConversions.status,
          lastStartedPhase: accountConversions.lastStartedPhase,
        })
        .from(accountConversions)
        .where(eq(accountConversions.idempotencyKey, request.idempotencyKey))
        .get();
      if (existing !== undefined) {
        if (existing.sourceUrl !== request.sourceUrl) {
          throw new Error("Conversion idempotency conflict");
        }
        return { result: "replayed", conversion: existing };
      }
      const retryAfter = this.limits.consume("account-conversion", startLimit, 60_000, nowMs);
      if (retryAfter) {
        return { result: "rate-limited", retryAfter };
      }
      const conversionId = crypto.randomUUID();
      this.database
        .insert(accountConversions)
        .values({
          conversionId,
          idempotencyKey: request.idempotencyKey,
          sourceUrl: request.sourceUrl,
          createdAtMs: nowMs,
          status: "pending",
          lastStartedPhase: ConversionPhase.CONVERSION_START,
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
        conversion: {
          conversionId,
          ...request,
          createdAtMs: nowMs,
          status: "pending",
          lastStartedPhase: ConversionPhase.CONVERSION_START,
        },
      };
    });
  }

  reserveMissingAudioSegments(
    conversionId: string,
    narrationTextCharactersBySegment: readonly number[],
    nowMs: number,
  ) {
    return this.duration.reserveMissing(conversionId, narrationTextCharactersBySegment, nowMs);
  }

  reservedAudioSegments() {
    return this.duration.reservedSegments();
  }

  completeAudioSegment(
    conversionId: string,
    sequence: number,
    durationMilliseconds: number,
    nowMs: number,
  ) {
    return this.duration.complete(conversionId, sequence, durationMilliseconds, nowMs);
  }

  retryPreparation(conversionId: string) {
    this.requireActive();
    this.database
      .update(accountConversions)
      .set({
        status: "pending",
        lastStartedPhase: ConversionPhase.CONVERSION_START,
        completedAtMs: null,
        ...EMPTY_OUTCOME_COLUMNS,
      })
      .where(
        and(
          eq(accountConversions.conversionId, conversionId),
          eq(accountConversions.status, "failed"),
        ),
      )
      .run();
  }

  /** A settled conversion keeps the phase it last started; callers check the execution first. */
  recordPhaseStarted(conversionId: string, phase: ConversionPhase) {
    const parsed = conversionPhaseSchema.parse(phase);
    this.database
      .update(accountConversions)
      .set({ lastStartedPhase: parsed })
      .where(
        and(
          eq(accountConversions.conversionId, conversionId),
          eq(accountConversions.status, "pending"),
        ),
      )
      .run();
  }

  releaseAudioSegment(conversionId: string, sequence: number) {
    this.duration.releaseReservations(
      conversionId,
      Temporal.Now.instant().epochMilliseconds,
      sequence,
    );
  }

  getPlaybackPosition(conversionId: string): PlaybackPosition | null {
    this.requireActive();
    if (this.isMarkedForDeletion(conversionId)) {
      return null;
    }
    const row = this.database
      .select()
      .from(accountPlaybackPositions)
      .where(eq(accountPlaybackPositions.conversionId, conversionId))
      .get();
    return row
      ? {
          synchronizationUnitId: row.synchronizationUnitId,
          offsetMilliseconds: row.offsetMilliseconds,
        }
      : null;
  }

  savePlaybackPosition(conversionId: string, position: PlaybackPosition) {
    this.requireActive();
    if (this.isMarkedForDeletion(conversionId)) {
      throw new Error("Account conversion does not exist");
    }
    const parsed = playbackPositionSchema.parse(position);
    this.database
      .insert(accountPlaybackPositions)
      .values({
        conversionId,
        ...parsed,
        offsetMilliseconds: Math.round(parsed.offsetMilliseconds),
      })
      .onConflictDoUpdate({
        target: accountPlaybackPositions.conversionId,
        set: { ...parsed, offsetMilliseconds: Math.round(parsed.offsetMilliseconds) },
      })
      .run();
  }

  listAudioSegments(conversionId: string) {
    if (this.isMarkedForDeletion(conversionId)) {
      return [];
    }
    return this.duration.segments(conversionId);
  }

  /**
   * Sets the conversion deletion marker and releases the conversion's open reservations in one
   * transaction, so no hold outlives the marker; settled segments stay charged. Returns the segment
   * sequences whose workflows may still run.
   */
  markConversionDeletion(
    conversionId: string,
    nowMs: number,
  ):
    | { result: "marked"; segmentSequences: number[] }
    | { result: "already-marked" | "not-found" | "account-unavailable" } {
    z.number().int().nonnegative().safe().parse(nowMs);
    return this.database.transaction(() => {
      if (this.snapshot().state === "deleting") {
        return { result: "account-unavailable" };
      }
      const row = this.database
        .select({ deletingSinceMs: accountConversions.deletingSinceMs })
        .from(accountConversions)
        .where(eq(accountConversions.conversionId, conversionId))
        .get();
      if (row === undefined) {
        return { result: "not-found" };
      }
      if (row.deletingSinceMs !== null) {
        return { result: "already-marked" };
      }
      this.database
        .update(accountConversions)
        .set({ deletingSinceMs: nowMs })
        .where(eq(accountConversions.conversionId, conversionId))
        .run();
      this.duration.releaseReservations(conversionId, nowMs);
      return {
        result: "marked",
        segmentSequences: this.duration.segments(conversionId).map((segment) => segment.sequence),
      };
    });
  }

  /** Each marked conversion still owes cleanup, and the alarm stays armed while any is listed. */
  conversionsMarkedForDeletion(): { conversionId: string; deletingSinceMs: number }[] {
    return this.database
      .select({
        conversionId: accountConversions.conversionId,
        deletingSinceMs: accountConversions.deletingSinceMs,
      })
      .from(accountConversions)
      .where(isNotNull(accountConversions.deletingSinceMs))
      .all()
      .map(({ conversionId, deletingSinceMs }) => {
        if (deletingSinceMs === null) {
          throw new Error("A conversion marked for deletion has no marker");
        }
        return { conversionId, deletingSinceMs };
      });
  }

  /**
   * The last cleanup step deletes a marked conversion's rows in one transaction, the marked row
   * last because the other rows reference it. Ledger history stays: segments only reference their
   * credit operations. An unmarked conversion is never touched.
   */
  removeMarkedConversion(conversionId: string): void {
    this.database.transaction(() => {
      if (!this.isMarkedForDeletion(conversionId)) {
        return;
      }
      this.database.delete(audioSegments).where(eq(audioSegments.conversionId, conversionId)).run();
      this.database
        .delete(accountPlaybackPositions)
        .where(eq(accountPlaybackPositions.conversionId, conversionId))
        .run();
      this.database.delete(pendingJobs).where(eq(pendingJobs.conversionId, conversionId)).run();
      this.database
        .delete(accountConversions)
        .where(eq(accountConversions.conversionId, conversionId))
        .run();
    });
  }

  settleConversion(
    conversionId: string,
    outcome: AccountConversionOutcome,
    nowMs: number,
    executionEpoch?: number,
    narrationTextCharactersBySegment?: readonly number[],
  ): void {
    z.number().int().nonnegative().safe().parse(nowMs);
    z.uuidv4().parse(conversionId);
    const parsed = accountOutcomeSchema.parse(outcome);
    this.database.transaction(() => {
      const account = this.snapshot();
      if (executionEpoch !== undefined && account.executionEpoch !== executionEpoch) {
        throw new Error("Account execution epoch mismatch");
      }
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
      ) {
        throw new Error("Account blocks conversion settlement");
      }
      const conversion = this.getConversion(conversionId);
      if (conversion === undefined) {
        throw new Error("Account conversion does not exist");
      }
      if (conversion.status !== "pending") {
        if (canonicalJson(conversion.outcome) !== canonicalJson(parsed)) {
          throw new Error("Conflicting conversion settlement");
        }
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
      ) {
        throw new Error("Private audiobook reference is outside its conversion prefix");
      }
      this.database
        .update(accountConversions)
        .set({ status: parsed.status, completedAtMs: nowMs, ...toOutcomeColumns(parsed) })
        .where(eq(accountConversions.conversionId, conversionId))
        .run();
      this.duration.releaseReservations(conversionId, nowMs);
      // Reserving with the ready outcome leaves no moment in which a prepared conversion has
      // undecided reservations: afterwards a segment without one means the document did not fit.
      if (parsed.status === "ready" && narrationTextCharactersBySegment !== undefined) {
        this.duration.reserveMissing(conversionId, narrationTextCharactersBySegment, nowMs);
      }
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

  inspectAccounting(): AccountAccountingInspection {
    const accounting = this.duration.inspectAccounting();
    return {
      ...accounting,
      balance: { unit: "audio-millisecond", ...accounting.balance },
    };
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

  history(cursor?: { createdAtMs: number; conversionId: string }): AccountHistoryPage {
    const rows = this.database
      .select({
        conversionId: accountConversions.conversionId,
        createdAtMs: accountConversions.createdAtMs,
      })
      .from(accountConversions)
      .where(
        and(
          isNull(accountConversions.deletingSinceMs),
          cursor
            ? or(
                lt(accountConversions.createdAtMs, cursor.createdAtMs),
                and(
                  eq(accountConversions.createdAtMs, cursor.createdAtMs),
                  lt(accountConversions.conversionId, cursor.conversionId),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(accountConversions.createdAtMs), desc(accountConversions.conversionId))
      .limit(51)
      .all();
    const items = rows.slice(0, 50).map((row) => {
      const conversion = requireRow(this.getConversion(row.conversionId));
      // Stored `ready` means prepared; history reports whether the audiobook can be played.
      return conversion.status === "ready"
        ? {
            ...conversion,
            status: derivePreparedConversionStatus(this.duration.segments(row.conversionId)),
          }
        : conversion;
    });
    const last = rows[49];
    return {
      items,
      nextCursor: rows.length > 50 && last ? `${last.createdAtMs}:${last.conversionId}` : null,
    };
  }

  /** A conversion marked for deletion reads as missing, which also fences its execution. */
  getConversion(conversionId: string):
    | (AccountConversion & {
        outcome: AccountConversionOutcome | null;
        completedAtMs: number | null;
      })
    | undefined {
    const row = this.database
      .select()
      .from(accountConversions)
      .where(
        and(
          eq(accountConversions.conversionId, conversionId),
          isNull(accountConversions.deletingSinceMs),
        ),
      )
      .get();
    if (!row) {
      return undefined;
    }
    return {
      conversionId: row.conversionId,
      idempotencyKey: row.idempotencyKey,
      sourceUrl: row.sourceUrl,
      createdAtMs: row.createdAtMs,
      status: row.status,
      lastStartedPhase: row.lastStartedPhase,
      completedAtMs: row.completedAtMs,
      outcome: toOutcome(row),
    };
  }

  markDispatched(conversionId: string): void {
    this.database
      .update(pendingJobs)
      .set({ state: "delivered" })
      .where(eq(pendingJobs.conversionId, conversionId))
      .run();
  }

  private isMarkedForDeletion(conversionId: string): boolean {
    return (
      this.database
        .select({ conversionId: accountConversions.conversionId })
        .from(accountConversions)
        .where(
          and(
            eq(accountConversions.conversionId, conversionId),
            isNotNull(accountConversions.deletingSinceMs),
          ),
        )
        .get() !== undefined
    );
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
    if (account.state !== "active") {
      throw new Error("Account is not active");
    }
    return account;
  }
}

type ConversionRow = typeof accountConversions.$inferSelect;
type OutcomeColumns = Pick<
  ConversionRow,
  "title" | "audiobookReference" | "hasCoverImage" | "failureCategory" | "explanation"
>;

const EMPTY_OUTCOME_COLUMNS = {
  title: null,
  audiobookReference: null,
  hasCoverImage: null,
  failureCategory: null,
  explanation: null,
} satisfies OutcomeColumns;

function toOutcomeColumns(outcome: AccountConversionOutcome): OutcomeColumns {
  if (outcome.status === "ready") {
    return {
      ...EMPTY_OUTCOME_COLUMNS,
      title: outcome.title,
      audiobookReference: outcome.audiobookReference,
      hasCoverImage: outcome.hasCoverImage ?? null,
    };
  }
  return {
    ...EMPTY_OUTCOME_COLUMNS,
    failureCategory: outcome.failureCategory,
    explanation: outcome.explanation,
  };
}

function toOutcome(row: ConversionRow): AccountConversionOutcome | null {
  if (row.status === "pending") {
    return null;
  }
  // Parsing restores the exact outcome shape, so settlement replays compare equal fingerprints.
  return accountOutcomeSchema.parse(
    row.status === "ready"
      ? {
          status: "ready",
          title: row.title,
          audiobookReference: row.audiobookReference,
          ...(row.hasCoverImage === true ? { hasCoverImage: true } : {}),
        }
      : { status: "failed", failureCategory: row.failureCategory, explanation: row.explanation },
  );
}
