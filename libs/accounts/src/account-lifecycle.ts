import { and, desc, eq, lte, or, sql } from "drizzle-orm";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";

import type { AccountSnapshot } from "#src/account-contracts.ts";
import { accounts, deletionChallenges, deletionAttempts } from "#src/account-sqlite-schema.ts";

export type DeletionAttempt = {
  attemptId: string;
  subject: string;
  accountId: string;
  email: string;
  scheduledAtMs: number;
  deadlineMs: number;
  state: "scheduled" | "restored" | "deleting" | "erased";
};

export class AccountLifecycleConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountLifecycleConflictError";
  }
}

/** Local transitions are atomic; registry delivery is a persisted, replayable outbox. */
export class AccountLifecycle {
  private readonly database: DrizzleSqliteDODatabase;
  private readonly snapshot: () => AccountSnapshot;
  constructor(storage: DurableObjectStorage, snapshot: () => AccountSnapshot) {
    this.database = drizzle(storage);
    this.snapshot = snapshot;
  }

  challenge(nowMs = Temporal.Now.instant().epochMilliseconds) {
    const account = this.snapshot();
    if (account.state === "deleting") throw new Error("Account deletion has started");
    const challengeId = crypto.randomUUID();
    this.database
      .delete(deletionChallenges)
      .where(or(lte(deletionChallenges.expiresAtMs, nowMs), eq(deletionChallenges.used, true)))
      .run();
    this.database
      .insert(deletionChallenges)
      .values({
        challengeId,
        executionEpoch: account.executionEpoch,
        state: account.state,
        issuedAtMs: nowMs,
        expiresAtMs: nowMs + 300_000,
      })
      .run();
    return {
      challengeId,
      issuedAtMs: nowMs,
      expiresAtMs: nowMs + 300_000,
      subject: account.subject,
    };
  }

  schedule(
    input: { challengeId: string; authenticatedAtSeconds: number; email: string },
    nowMs = Temporal.Now.instant().epochMilliseconds,
  ) {
    z.email().parse(input.email);
    return this.database.transaction(() => {
      const account = this.snapshot();
      if (account.state === "deletion_scheduled") return this.current();
      this.consume(input.challengeId, input.authenticatedAtSeconds, nowMs);
      if (account.state !== "active")
        throw new AccountLifecycleConflictError("Account deletion has started");
      const attempt: DeletionAttempt = {
        attemptId: crypto.randomUUID(),
        accountId: account.accountId,
        subject: account.subject,
        email: input.email,
        scheduledAtMs: nowMs,
        deadlineMs: nowMs + 7 * 24 * 60 * 60 * 1_000,
        state: "scheduled",
      };
      this.database
        .insert(deletionAttempts)
        .values({ attemptId: attempt.attemptId, json: JSON.stringify(attempt), state: "scheduled" })
        .run();
      this.database
        .update(accounts)
        .set({ state: "deletion_scheduled", recoveryDeadlineMs: attempt.deadlineMs })
        .where(eq(accounts.id, 1))
        .run();
      return attempt;
    });
  }

  restore(
    challengeId: string,
    authenticatedAtSeconds: number,
    nowMs = Temporal.Now.instant().epochMilliseconds,
  ) {
    return this.database.transaction(() => {
      const account = this.snapshot();
      this.consume(challengeId, authenticatedAtSeconds, nowMs);
      if (
        account.state !== "deletion_scheduled" ||
        account.recoveryDeadlineMs === null ||
        nowMs >= account.recoveryDeadlineMs
      )
        throw new AccountLifecycleConflictError("Recovery deadline has passed");
      const attempt = this.current();
      if (!attempt) throw new Error("Deletion attempt missing");
      this.database
        .update(deletionAttempts)
        .set({ state: "restored", delivered: false })
        .where(eq(deletionAttempts.attemptId, attempt.attemptId))
        .run();
      this.database
        .update(accounts)
        .set({ state: "active", recoveryDeadlineMs: null })
        .where(eq(accounts.id, 1))
        .run();
      return { ...attempt, state: "restored" as const };
    });
  }

  current(): DeletionAttempt | undefined {
    const row = this.database
      .select({ json: deletionAttempts.json, state: deletionAttempts.state })
      .from(deletionAttempts)
      .orderBy(desc(sql`rowid`))
      .limit(1)
      .get();
    return row
      ? { ...deletionAttemptSchema.parse(JSON.parse(row.json)), state: row.state }
      : undefined;
  }

  outbox() {
    return this.database
      .select({ json: deletionAttempts.json, state: deletionAttempts.state })
      .from(deletionAttempts)
      .where(eq(deletionAttempts.delivered, false))
      .all()
      .map((row) => ({ ...deletionAttemptSchema.parse(JSON.parse(row.json)), state: row.state }));
  }
  delivered(attemptId: string, state: DeletionAttempt["state"]) {
    this.database.transaction(() => {
      const row = this.database
        .select({ json: deletionAttempts.json })
        .from(deletionAttempts)
        .where(and(eq(deletionAttempts.attemptId, attemptId), eq(deletionAttempts.state, state)))
        .get();
      if (!row) return;
      const payload = deletionAttemptSchema.parse(JSON.parse(row.json));
      this.database
        .update(deletionAttempts)
        .set({ delivered: true, json: JSON.stringify({ ...payload, email: "" }) })
        .where(and(eq(deletionAttempts.attemptId, attemptId), eq(deletionAttempts.state, state)))
        .run();
    });
  }
  fence(attemptId: string, nowMs = Temporal.Now.instant().epochMilliseconds) {
    this.database.transaction(() => {
      const attempt = this.current();
      if (!attempt || attempt.attemptId !== attemptId || attempt.state === "restored")
        throw new Error("Deletion attempt was superseded");
      if (nowMs < attempt.deadlineMs) throw new Error("Recovery period has not ended");
      this.database
        .update(accounts)
        .set({ state: "deleting", executionEpoch: sql`${accounts.executionEpoch} + 1` })
        .where(eq(accounts.state, "deletion_scheduled"))
        .run();
      this.database
        .update(deletionAttempts)
        .set({ state: "deleting" })
        .where(eq(deletionAttempts.attemptId, attemptId))
        .run();
    });
  }

  private consume(challengeId: string, authenticatedAtSeconds: number, nowMs: number) {
    z.uuidv4().parse(challengeId);
    const account = this.snapshot();
    const challenge = this.database
      .select()
      .from(deletionChallenges)
      .where(eq(deletionChallenges.challengeId, challengeId))
      .get();
    if (
      !challenge ||
      challenge.used ||
      challenge.executionEpoch !== account.executionEpoch ||
      challenge.state !== account.state ||
      nowMs >= challenge.expiresAtMs ||
      authenticatedAtSeconds * 1_000 <= challenge.issuedAtMs ||
      authenticatedAtSeconds * 1_000 > nowMs + 5_000
    )
      throw new AccountLifecycleConflictError(
        "Fresh Google sign-in after the challenge is required",
      );
    this.database
      .update(deletionChallenges)
      .set({ used: true })
      .where(eq(deletionChallenges.challengeId, challengeId))
      .run();
  }
}

export const deletionAttemptSchema = z.object({
  attemptId: z.uuidv4(),
  subject: z.uuid(),
  accountId: z.uuidv4(),
  email: z.string(),
  scheduledAtMs: z.number().int(),
  deadlineMs: z.number().int(),
  state: z.enum(["scheduled", "restored", "deleting", "erased"]),
});
