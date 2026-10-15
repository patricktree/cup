import { and, asc, eq, gt, lte, min } from "drizzle-orm";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { z } from "zod";

import { rateEvents } from "#src/rate-limit-schema.ts";

/** A serialized rolling window, with no fixed-window boundary burst. */
export class RollingLimits {
  private readonly database: DrizzleSqliteDODatabase;
  constructor(storage: DurableObjectStorage) {
    this.database = drizzle(storage);
  }
  consume(bucket: string, maximum: number, windowMs: number, nowMs: number) {
    z.string().min(1).max(256).parse(bucket);
    z.number().int().positive().parse(maximum);
    z.number().int().positive().parse(windowMs);
    return this.database.transaction(() => {
      this.expire(nowMs);
      const events = this.database
        .select({ time: rateEvents.createdAtMs })
        .from(rateEvents)
        .where(and(eq(rateEvents.bucket, bucket), gt(rateEvents.createdAtMs, nowMs - windowMs)))
        .orderBy(asc(rateEvents.createdAtMs))
        .all();
      if (events.length >= maximum) {
        return Math.max(1, Math.ceil(((events[0]?.time ?? nowMs) + windowMs - nowMs) / 1000));
      }
      this.database
        .insert(rateEvents)
        .values({
          bucket,
          eventId: crypto.randomUUID(),
          createdAtMs: nowMs,
          expiresAtMs: nowMs + windowMs,
        })
        .run();
      return 0;
    });
  }
  expire(nowMs: number) {
    this.database.delete(rateEvents).where(lte(rateEvents.expiresAtMs, nowMs)).run();
  }
  nextAlarm() {
    const row = this.database
      .select({ next: min(rateEvents.expiresAtMs) })
      .from(rateEvents)
      .get();
    // An aggregate without GROUP BY always yields one row, even for an empty table.
    if (row === undefined) {
      throw new Error("Required SQLite row is missing");
    }
    return row.next;
  }
}
