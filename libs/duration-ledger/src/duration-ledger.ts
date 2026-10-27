import { and, asc, count, eq, sql } from "drizzle-orm";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { z } from "zod";

import {
  estimateAudioDuration,
  type SegmentUsage,
} from "@cup/conversion-contracts/duration-accounting";

import {
  creditBalances,
  creditLedger,
  creditOperations,
  type AudioSegmentsTable,
} from "#src/duration-ledger-schema.ts";

export type DurationTotals = {
  allowanceMilliseconds: number;
  availableMilliseconds: number;
  reservedMilliseconds: number;
  spentMilliseconds: number;
};

/**
 * Keeps one owner's duration allowance, reservations, and encoded-duration charges in an
 * append-only ledger. The balance row caches the ledger's sums so that checks stay cheap.
 */
export class DurationLedger {
  private readonly database: DrizzleSqliteDODatabase;
  private readonly segmentsTable: AudioSegmentsTable;

  constructor(storage: DurableObjectStorage, segmentsTable: AudioSegmentsTable) {
    this.database = drizzle(storage);
    this.segmentsTable = segmentsTable;
  }

  /** Opens the ledger with its first allowance grant. */
  initialize(operationId: string, amount: number, cause: string, nowMs: number): void {
    this.database.transaction(() => {
      this.database
        .insert(creditBalances)
        .values({ unit: "audio-millisecond", available: 0, reserved: 0 })
        .run();
      this.database
        .insert(creditOperations)
        .values({
          operationId,
          requestId: operationId,
          kind: "grant",
          unit: "audio-millisecond",
          amount,
          state: "completed",
          cause,
        })
        .run();
      this.appendEntry(operationId, "grant", amount, amount, 0, nowMs, cause);
    });
  }

  balance(): { available: number; reserved: number } {
    const balance = this.rawBalance();
    return { available: Math.max(0, balance.available), reserved: balance.reserved };
  }

  totals(): DurationTotals {
    const sums = requireRow(
      this.database
        .select({
          allowance: sql<number>`coalesce(sum(CASE WHEN ${creditLedger.eventKind} IN ('grant', 'adjustment') THEN ${creditLedger.availableDelta} ELSE 0 END), 0)`,
          spent: sql<number>`coalesce(sum(CASE WHEN ${creditLedger.eventKind} = 'consume' THEN ${creditLedger.amount} ELSE 0 END), 0)`,
        })
        .from(creditLedger)
        .get(),
    );
    const balance = this.balance();
    return {
      allowanceMilliseconds: sums.allowance,
      availableMilliseconds: balance.available,
      reservedMilliseconds: balance.reserved,
      spentMilliseconds: sums.spent,
    };
  }

  /**
   * Orders the ledger's states: every change to the allowance, reserved, or spent duration appends
   * an event, and events are never removed, so the count grows with each change and only then.
   */
  revision(): number {
    return requireRow(this.database.select({ events: count() }).from(creditLedger).get()).events;
  }

  /**
   * Reserves every segment lacking audio, or none when their whole estimate exceeds the available
   * duration. `refuseNewReservations` lets the owner refuse when anything would be reserved, while
   * a request that only finds existing reservations still succeeds.
   */
  reserveMissing<Refusal extends string = never>(
    conversionId: string,
    narrationTextCharactersBySegment: readonly number[],
    nowMs: number,
    refuseNewReservations?: () => Refusal | undefined,
  ):
    | { result: "reserved"; sequences: number[]; hasChanged: boolean }
    | {
        result: "insufficient-duration";
        requiredMilliseconds: number;
        availableMilliseconds: number;
      }
    | { result: Refusal } {
    return this.database.transaction(() => {
      const existing = new Map(
        this.segments(conversionId).map((segment) => [segment.sequence, segment]),
      );
      const missing = narrationTextCharactersBySegment.flatMap((characters, sequence) => {
        const segment = existing.get(sequence);
        if (segment === undefined || segment.state === "released") {
          return [{ sequence, characters, estimate: estimateAudioDuration(characters) }];
        }
        if (segment.narrationTextCharacters !== characters) {
          throw new Error("Segment reservation conflicts with synthesis identity");
        }
        return [];
      });

      if (missing.length > 0) {
        const refusal = refuseNewReservations?.();
        if (refusal !== undefined) {
          return { result: refusal };
        }
      }

      const requiredMilliseconds = missing.reduce((total, segment) => total + segment.estimate, 0);
      const availableMilliseconds = this.balance().available;
      if (requiredMilliseconds > availableMilliseconds) {
        return {
          result: "insufficient-duration" as const,
          requiredMilliseconds,
          availableMilliseconds,
        };
      }

      for (const segment of missing) {
        this.insertReservation(
          conversionId,
          segment.sequence,
          segment.characters,
          segment.estimate,
          nowMs,
        );
      }
      return {
        result: "reserved" as const,
        sequences: this.segments(conversionId)
          .filter((segment) => segment.state === "reserved")
          .map((segment) => segment.sequence),
        hasChanged: missing.length > 0,
      };
    });
  }

  reservedSegments(): { conversionId: string; sequence: number }[] {
    return this.database
      .select({
        conversionId: this.segmentsTable.conversionId,
        sequence: this.segmentsTable.sequence,
      })
      .from(this.segmentsTable)
      .where(eq(this.segmentsTable.state, "reserved"))
      .all();
  }

  complete(conversionId: string, sequence: number, durationMilliseconds: number, nowMs: number) {
    z.number().positive().finite().parse(durationMilliseconds);
    const actual = z.number().int().positive().safe().parse(Math.ceil(durationMilliseconds));
    return this.database.transaction(() => {
      const segment = this.segment(conversionId, sequence);
      if (!segment) {
        throw new Error("Audio segment has no duration reservation");
      }
      if (segment.state === "settled") {
        if (segment.actualMilliseconds !== actual) {
          throw new Error("Conflicting audio duration settlement");
        }
        return { result: "replayed" as const };
      }
      if (segment.state !== "reserved") {
        throw new Error("Audio segment reservation was released");
      }
      const balance = this.rawBalance();
      const charged = Math.min(actual, balance.available + balance.reserved);
      this.database
        .update(this.segmentsTable)
        .set({ state: "settled", actualMilliseconds: actual, chargedMilliseconds: charged })
        .where(this.segmentKey(conversionId, sequence))
        .run();
      this.database
        .update(creditOperations)
        .set({ state: "consumed" })
        .where(eq(creditOperations.operationId, segment.operationId))
        .run();
      // An overrun can temporarily exceed the unreserved balance. Keep other reservations intact,
      // cap total charges at the remaining allowance, and expose zero availability until they settle.
      this.appendEntry(
        segment.operationId,
        "consume",
        charged,
        segment.estimatedMilliseconds - charged,
        -segment.estimatedMilliseconds,
        nowMs,
        conversionId,
      );
      return { result: "recorded" as const };
    });
  }

  /** Releases the conversion's open reservations, or only `sequence`'s; returns how many. */
  releaseReservations(conversionId: string, nowMs: number, sequence?: number): number {
    return this.database.transaction(() => {
      let releasedCount = 0;
      for (const segment of this.segmentRows(conversionId)) {
        if (
          segment.state !== "reserved" ||
          (sequence !== undefined && segment.sequence !== sequence)
        ) {
          continue;
        }
        this.database
          .update(this.segmentsTable)
          .set({ state: "released" })
          .where(this.segmentKey(conversionId, segment.sequence))
          .run();
        this.database
          .update(creditOperations)
          .set({ state: "released" })
          .where(eq(creditOperations.operationId, segment.operationId))
          .run();
        this.appendEntry(
          segment.operationId,
          "release",
          segment.estimatedMilliseconds,
          segment.estimatedMilliseconds,
          -segment.estimatedMilliseconds,
          nowMs,
          conversionId,
        );
        releasedCount += 1;
      }
      return releasedCount;
    });
  }

  segments(conversionId: string): SegmentUsage[] {
    return this.segmentRows(conversionId).map(toSegmentUsage);
  }

  allSegments(): SegmentUsage[] {
    return this.database
      .select()
      .from(this.segmentsTable)
      .orderBy(asc(this.segmentsTable.conversionId), asc(this.segmentsTable.sequence))
      .all()
      .map(toSegmentUsage);
  }

  /**
   * Records a signed allowance change once per request ID. A reduction may not exceed the available
   * duration, so reserved and spent duration always stay covered.
   */
  adjustAllowance(requestId: string, amount: number, cause: string, nowMs: number): void {
    z.number().int().nonnegative().safe().parse(nowMs);
    z.uuidv4().parse(requestId);
    z.number()
      .int()
      .safe()
      .refine((value) => value !== 0)
      .parse(amount);
    z.string().min(1).max(256).parse(cause);
    this.database.transaction(() => {
      const operationId = `adjustment:${requestId}`;
      const existing = this.database
        .select({ delta: creditLedger.availableDelta, cause: creditLedger.cause })
        .from(creditLedger)
        .where(eq(creditLedger.operationId, operationId))
        .get();
      if (existing) {
        if (existing.delta !== amount || existing.cause !== cause) {
          throw new Error("Allowance adjustment idempotency conflict");
        }
        return;
      }
      if (amount < 0 && -amount > this.balance().available) {
        throw new Error("Allowance adjustment exceeds available duration");
      }
      this.database
        .insert(creditOperations)
        .values({
          operationId,
          requestId: operationId,
          kind: "adjustment",
          unit: "audio-millisecond",
          amount: Math.abs(amount),
          state: "completed",
          cause,
        })
        .run();
      this.appendEntry(operationId, "adjustment", Math.abs(amount), amount, 0, nowMs, cause);
    });
  }

  /** Verifies that the cached balance equals the ledger's sums. */
  inspectAccounting() {
    const totals = requireRow(
      this.database
        .select({
          available: sql<number>`coalesce(sum(${creditLedger.availableDelta}), 0)`,
          reserved: sql<number>`coalesce(sum(${creditLedger.reservedDelta}), 0)`,
          entries: count(),
        })
        .from(creditLedger)
        .get(),
    );
    const balance = this.rawBalance();
    if (balance.available !== totals.available || balance.reserved !== totals.reserved) {
      throw new Error("Duration balance does not match its credit ledger");
    }
    return {
      balance: this.balance(),
      reconstructed: { available: Math.max(0, totals.available), reserved: totals.reserved },
      entries: totals.entries,
    };
  }

  private insertReservation(
    conversionId: string,
    sequence: number,
    characters: number,
    estimate: number,
    nowMs: number,
  ): void {
    const operationId = `segment:${conversionId}:${sequence}:${crypto.randomUUID()}`;
    this.database
      .insert(creditOperations)
      .values({
        operationId,
        requestId: operationId,
        kind: "reservation",
        unit: "audio-millisecond",
        amount: estimate,
        state: "reserved",
        cause: conversionId,
      })
      .run();
    const reservation = {
      narrationTextCharacters: characters,
      estimatedMilliseconds: estimate,
      state: "reserved" as const,
      actualMilliseconds: 0,
      chargedMilliseconds: 0,
      operationId,
    };
    this.database
      .insert(this.segmentsTable)
      .values({ conversionId, sequence, ...reservation })
      .onConflictDoUpdate({
        target: [this.segmentsTable.conversionId, this.segmentsTable.sequence],
        set: reservation,
      })
      .run();
    this.appendEntry(operationId, "reserve", estimate, -estimate, estimate, nowMs, conversionId);
  }

  private segment(conversionId: string, sequence: number) {
    return this.database
      .select()
      .from(this.segmentsTable)
      .where(this.segmentKey(conversionId, sequence))
      .get();
  }

  private segmentRows(conversionId: string) {
    return this.database
      .select()
      .from(this.segmentsTable)
      .where(eq(this.segmentsTable.conversionId, conversionId))
      .orderBy(asc(this.segmentsTable.sequence))
      .all();
  }

  private segmentKey(conversionId: string, sequence: number) {
    return and(
      eq(this.segmentsTable.conversionId, conversionId),
      eq(this.segmentsTable.sequence, sequence),
    );
  }

  private rawBalance() {
    return requireRow(
      this.database
        .select({ available: creditBalances.available, reserved: creditBalances.reserved })
        .from(creditBalances)
        .where(eq(creditBalances.unit, "audio-millisecond"))
        .get(),
    );
  }

  private appendEntry(
    operationId: string,
    kind: typeof creditLedger.$inferInsert.eventKind,
    amount: number,
    availableDelta: number,
    reservedDelta: number,
    nowMs: number,
    cause: string,
  ): void {
    this.database
      .insert(creditLedger)
      .values({
        eventId: `${operationId}:${kind}`,
        operationId,
        eventKind: kind,
        unit: "audio-millisecond",
        amount,
        availableDelta,
        reservedDelta,
        createdAtMs: nowMs,
        cause,
      })
      .run();
    this.database
      .update(creditBalances)
      .set({
        available: sql`${creditBalances.available} + ${availableDelta}`,
        reserved: sql`${creditBalances.reserved} + ${reservedDelta}`,
      })
      .where(eq(creditBalances.unit, "audio-millisecond"))
      .run();
  }
}

function toSegmentUsage(row: AudioSegmentsTable["$inferSelect"]): SegmentUsage {
  return {
    conversionId: row.conversionId,
    sequence: row.sequence,
    narrationTextCharacters: row.narrationTextCharacters,
    estimatedMilliseconds: row.estimatedMilliseconds,
    state: row.state,
    actualMilliseconds: row.actualMilliseconds,
    chargedMilliseconds: row.chargedMilliseconds,
  };
}

/** Preserves the fail-fast behavior of storage cursors for required rows. */
function requireRow<T>(row: T | undefined): T {
  if (row === undefined) {
    throw new Error("Required SQLite row is missing");
  }
  return row;
}
