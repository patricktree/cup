import { and, asc, count, eq, sql } from "drizzle-orm";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { z } from "zod";

import {
  estimateAudioDuration,
  type SegmentUsage,
} from "@cup/conversion-contracts/duration-accounting";

import type { AccountSnapshot } from "#src/account-contracts.ts";
import {
  accountAudioSegments,
  creditBalances,
  creditOperations,
  creditLedger,
} from "#src/account-sqlite-schema.ts";
import { requireRow } from "#src/sqlite-row.ts";

const WELCOME_ALLOWANCE_MILLISECONDS = 30 * 60 * 1_000;

/** Keep reservations and encoded-duration charges in an append-only ledger. */
export class AccountDurationLedger {
  private readonly database: DrizzleSqliteDODatabase;

  constructor(storage: DurableObjectStorage) {
    this.database = drizzle(storage);
  }

  initialize(accountId: string, nowMs: number): void {
    this.database
      .insert(creditBalances)
      .values({ unit: "audio-millisecond", available: 0, reserved: 0 })
      .run();
    const operationId = `welcome:${accountId}:v1`;
    this.database
      .insert(creditOperations)
      .values({
        operationId,
        requestId: operationId,
        kind: "grant",
        unit: "audio-millisecond",
        amount: WELCOME_ALLOWANCE_MILLISECONDS,
        state: "completed",
        cause: "welcome-v1",
      })
      .run();
    this.appendEntry(
      operationId,
      "grant",
      WELCOME_ALLOWANCE_MILLISECONDS,
      WELCOME_ALLOWANCE_MILLISECONDS,
      0,
      nowMs,
      "welcome-v1",
    );
  }

  balance(): AccountSnapshot["balance"] {
    const balance = this.rawBalance();
    return {
      unit: "audio-millisecond",
      available: Math.max(0, balance.available),
      reserved: balance.reserved,
    };
  }

  reserve(conversionId: string, sequence: number, characters: number, nowMs: number) {
    z.number().int().nonnegative().safe().parse(sequence);
    const estimate = estimateAudioDuration(characters);
    return this.database.transaction(() => {
      const existing = this.segments(conversionId).find((item) => item.sequence === sequence);
      if (existing && existing.state !== "released") {
        if (existing.narrationTextCharacters !== characters)
          throw new Error("Segment reservation conflicts with synthesis identity");
        return {
          result: existing.state === "settled" ? ("settled" as const) : ("reserved" as const),
        };
      }
      if (estimate > this.balance().available) return { result: "insufficient-duration" as const };
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
      this.database
        .insert(accountAudioSegments)
        .values({
          conversionId,
          sequence,
          narrationTextCharacters: characters,
          estimatedMilliseconds: estimate,
          state: "reserved",
          operationId,
        })
        .onConflictDoUpdate({
          target: [accountAudioSegments.conversionId, accountAudioSegments.sequence],
          set: {
            operationId,
            state: "reserved",
            estimatedMilliseconds: estimate,
            actualMilliseconds: 0,
            chargedMilliseconds: 0,
          },
        })
        .run();
      this.appendEntry(operationId, "reserve", estimate, -estimate, estimate, nowMs, conversionId);
      return { result: "reserved" as const };
    });
  }

  complete(conversionId: string, sequence: number, durationMilliseconds: number, nowMs: number) {
    z.number().positive().finite().parse(durationMilliseconds);
    const actual = z.number().int().positive().safe().parse(Math.ceil(durationMilliseconds));
    return this.database.transaction(() => {
      const segment = this.segments(conversionId).find((item) => item.sequence === sequence);
      if (!segment) throw new Error("Audio segment has no duration reservation");
      if (segment.state === "settled") {
        if (segment.actualMilliseconds !== actual)
          throw new Error("Conflicting audio duration settlement");
        return { result: "replayed" as const };
      }
      if (segment.state !== "reserved") throw new Error("Audio segment reservation was released");
      const balance = this.rawBalance();
      const charged = Math.min(actual, balance.available + balance.reserved);
      const operationId = requireRow(
        this.database
          .select({ operationId: accountAudioSegments.operationId })
          .from(accountAudioSegments)
          .where(
            and(
              eq(accountAudioSegments.conversionId, conversionId),
              eq(accountAudioSegments.sequence, sequence),
            ),
          )
          .get(),
      ).operationId;
      this.database
        .update(accountAudioSegments)
        .set({ state: "settled", actualMilliseconds: actual, chargedMilliseconds: charged })
        .where(
          and(
            eq(accountAudioSegments.conversionId, conversionId),
            eq(accountAudioSegments.sequence, sequence),
          ),
        )
        .run();
      this.database
        .update(creditOperations)
        .set({ state: "consumed" })
        .where(eq(creditOperations.operationId, operationId))
        .run();
      // An overrun can temporarily exceed the unreserved balance. Keep other reservations intact,
      // cap total charges at the remaining allowance, and expose zero availability until they settle.
      this.appendEntry(
        operationId,
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

  releaseReservations(conversionId: string, nowMs: number, sequence?: number): void {
    for (const segment of this.segments(conversionId)) {
      if (segment.state !== "reserved" || (sequence !== undefined && segment.sequence !== sequence))
        continue;
      const operationId = requireRow(
        this.database
          .select({ operationId: accountAudioSegments.operationId })
          .from(accountAudioSegments)
          .where(
            and(
              eq(accountAudioSegments.conversionId, conversionId),
              eq(accountAudioSegments.sequence, segment.sequence),
            ),
          )
          .get(),
      ).operationId;
      this.database
        .update(accountAudioSegments)
        .set({ state: "released" })
        .where(
          and(
            eq(accountAudioSegments.conversionId, conversionId),
            eq(accountAudioSegments.sequence, segment.sequence),
          ),
        )
        .run();
      this.database
        .update(creditOperations)
        .set({ state: "released" })
        .where(eq(creditOperations.operationId, operationId))
        .run();
      this.appendEntry(
        operationId,
        "release",
        segment.estimatedMilliseconds,
        segment.estimatedMilliseconds,
        -segment.estimatedMilliseconds,
        nowMs,
        conversionId,
      );
    }
  }

  segments(conversionId: string): SegmentUsage[] {
    return this.database
      .select({
        conversionId: accountAudioSegments.conversionId,
        sequence: accountAudioSegments.sequence,
        narrationTextCharacters: accountAudioSegments.narrationTextCharacters,
        estimatedMilliseconds: accountAudioSegments.estimatedMilliseconds,
        state: accountAudioSegments.state,
        actualMilliseconds: accountAudioSegments.actualMilliseconds,
        chargedMilliseconds: accountAudioSegments.chargedMilliseconds,
      })
      .from(accountAudioSegments)
      .where(eq(accountAudioSegments.conversionId, conversionId))
      .orderBy(asc(accountAudioSegments.sequence))
      .all();
  }

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
        if (existing.delta !== amount || existing.cause !== cause)
          throw new Error("Allowance adjustment idempotency conflict");
        return;
      }
      if (amount < 0 && -amount > this.balance().available)
        throw new Error("Allowance adjustment exceeds available duration");
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
    if (balance.available !== totals.available || balance.reserved !== totals.reserved)
      throw new Error("Account balance does not match its credit ledger");
    return {
      balance: this.balance(),
      reconstructed: { available: Math.max(0, totals.available), reserved: totals.reserved },
      entries: totals.entries,
    };
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
