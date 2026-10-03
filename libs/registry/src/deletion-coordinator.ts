import { and, asc, eq, inArray, lte, min, sql } from "drizzle-orm";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";

import type { AccountDurableObject } from "@cup/accounts";
import { deletionAttemptSchema, type DeletionAttempt } from "@cup/accounts/lifecycle";

import {
  canceledDeletionAttempts,
  deletionJobs,
  deletionNotifications,
  deletionReceipts,
} from "#src/registry-sqlite-schema.ts";
import { requireRow } from "#src/sqlite-row.ts";
import type { SupabaseAdminEnvironment } from "#src/supabase-identity.ts";

export type DeletionEnvironment = SupabaseAdminEnvironment & {
  ACCOUNTS: DurableObjectNamespace<AccountDurableObject>;
  RESEND_API_KEY?: string;
};
const DAY = 86_400_000;
const jobSchema = deletionAttemptSchema.extend({
  googleRevocation: z.enum(["unavailable", "revoked", "failed"]).default("unavailable"),
  identityDone: z.boolean(),
  accountDone: z.boolean(),
  failures: z.number().int(),
  nextAttemptMs: z.number(),
});
type DeletionJob = z.infer<typeof jobSchema>;
const notificationSchema = z.object({
  key: z.string(),
  email: z.string(),
  subject: z.string(),
  text: z.string(),
  firstAttemptMs: z.number().nullable(),
  nextAttemptMs: z.number(),
  attempts: z.number(),
  state: z.enum(["pending", "sent", "failed", "expired", "canceled"]),
});
type Notification = z.infer<typeof notificationSchema>;

/** Owns cleanup and notification intent independently of the account being erased. */
export class DeletionCoordinator {
  private readonly database: DrizzleSqliteDODatabase;
  private readonly storage: DurableObjectStorage;
  private readonly env: DeletionEnvironment;
  private readonly request: typeof fetch;
  constructor(
    storage: DurableObjectStorage,
    env: DeletionEnvironment,
    request: typeof fetch = fetch,
  ) {
    this.storage = storage;
    this.database = drizzle(storage);
    this.env = env;
    this.request = request;
  }

  async accept(input: DeletionAttempt) {
    const attempt = deletionAttemptSchema.parse(input);
    await this.storage.setAlarm(Temporal.Now.instant().epochMilliseconds + 60_000);
    this.database.transaction(() => {
      const canceled = this.database
        .select({ attemptId: canceledDeletionAttempts.attemptId })
        .from(canceledDeletionAttempts)
        .where(eq(canceledDeletionAttempts.attemptId, attempt.attemptId))
        .get();
      if (canceled) return;
      const existing = this.job(attempt.attemptId);
      if (
        existing &&
        (existing.accountId !== attempt.accountId ||
          existing.subject !== attempt.subject ||
          existing.deadlineMs !== attempt.deadlineMs)
      )
        throw new Error("Deletion attempt identity conflict");
      if (attempt.state === "restored") {
        if (existing?.state === "deleting") throw new Error("Deletion cleanup has started");
        this.database
          .insert(canceledDeletionAttempts)
          .values({
            attemptId: attempt.attemptId,
            expiresAtMs: Temporal.Now.instant().epochMilliseconds + 90 * DAY,
          })
          .onConflictDoNothing()
          .run();
        if (existing) this.save({ ...existing, state: "restored", email: "" });
        this.cancelNotification(`${attempt.attemptId}:scheduled`);
        return;
      }
      if (!existing) {
        this.save({
          ...attempt,
          state: "scheduled",
          googleRevocation: "unavailable",
          identityDone: false,
          accountDone: false,
          failures: 0,
          nextAttemptMs: attempt.deadlineMs,
        });
        this.enqueue(
          attempt,
          "scheduled",
          "Your Cup account deletion is scheduled",
          `Your Cup account is scheduled for deletion on ${Temporal.Instant.fromEpochMilliseconds(attempt.deadlineMs).toString()}. Until that time, sign in at https://cup-audio.com/app/account and choose Restore account. Signing in alone does not cancel deletion.`,
        );
      }
    });
  }

  async reconcile(
    fenceIdentity: (subject: string, accountId: string) => void,
    removeIdentity: (subject: string, accountId: string) => void,
  ) {
    const nowMs = Temporal.Now.instant().epochMilliseconds;
    this.database.delete(deletionReceipts).where(lte(deletionReceipts.expiresAtMs, nowMs)).run();
    this.database
      .delete(canceledDeletionAttempts)
      .where(lte(canceledDeletionAttempts.expiresAtMs, nowMs))
      .run();
    const rows = this.database
      .select({ json: deletionJobs.json })
      .from(deletionJobs)
      .where(
        and(
          inArray(sql<string>`json_extract(${deletionJobs.json}, '$.state')`, [
            "scheduled",
            "deleting",
          ]),
          lte(sql<number>`json_extract(${deletionJobs.json}, '$.nextAttemptMs')`, nowMs),
        ),
      )
      .orderBy(
        asc(sql`json_extract(${deletionJobs.json}, '$.nextAttemptMs')`),
        asc(deletionJobs.attemptId),
      )
      .limit(100)
      .all();
    for (const row of rows) {
      const job = jobSchema.parse(JSON.parse(row.json));
      if (job.state === "restored") {
        this.receiptIfFinished(job, "restored");
        continue;
      }
      if (job.state === "erased" || nowMs < job.nextAttemptMs) continue;
      const account = this.env.ACCOUNTS.get(this.env.ACCOUNTS.idFromName(job.accountId));
      try {
        if (job.state === "scheduled") {
          await account.fenceDeletion(job.attemptId);
          fenceIdentity(job.subject, job.accountId);
          job.state = "deleting";
          this.save(job);
        }
        // Identity unavailability must not block independent Cup storage cleanup.
        if (!job.identityDone) {
          try {
            await this.deleteIdentity(job.subject);
            job.identityDone = true;
            this.save(job);
          } catch {
            /* Retry exact identity on the durable alarm. */
          }
        }
        if (!job.accountDone) {
          try {
            await account.eraseAccount(job.attemptId);
            job.accountDone = true;
            this.save(job);
          } catch {
            /* Writers or storage outages remain pending. */
          }
        }
        if (job.identityDone && job.accountDone) {
          removeIdentity(job.subject, job.accountId);
          job.state = "erased";
          this.save(job);
          this.enqueue(
            job,
            "completed",
            "Your Cup account has been deleted",
            "Your Cup account and its private conversions have been deleted. Original trial conversions remain separate. You can create a new Cup account at https://cup-audio.com/app.",
          );
        } else throw new Error("Deletion dependencies are pending");
      } catch {
        job.failures += 1;
        job.nextAttemptMs =
          nowMs +
          Math.min(3_600_000, 60_000 * 2 ** Math.min(job.failures - 1, 6)) +
          Math.floor(Math.random() * 5_000);
        this.save(job);
      }
    }
    await this.sendNotifications();
    for (const row of this.database.select({ json: deletionJobs.json }).from(deletionJobs).all()) {
      const job = jobSchema.parse(JSON.parse(row.json));
      if (job.state === "erased") this.receiptIfFinished(job, "erased");
      if (job.state === "restored") this.receiptIfFinished(job, "restored");
    }
  }

  nextAlarm() {
    const times = this.database
      .select({ json: deletionJobs.json })
      .from(deletionJobs)
      .all()
      .map((row) => jobSchema.parse(JSON.parse(row.json)))
      .filter((job) => !["erased", "restored"].includes(job.state))
      .map((job) => job.nextAttemptMs);
    for (const row of this.database
      .select({ json: deletionNotifications.json })
      .from(deletionNotifications)
      .all()) {
      const notification = notificationSchema.parse(JSON.parse(row.json));
      if (notification.state === "pending") times.push(notification.nextAttemptMs);
    }
    const receipt = requireRow(
      this.database
        .select({ next: min(deletionReceipts.expiresAtMs) })
        .from(deletionReceipts)
        .get(),
    ).next;
    if (receipt !== null) times.push(receipt);
    const canceled = requireRow(
      this.database
        .select({ next: min(canceledDeletionAttempts.expiresAtMs) })
        .from(canceledDeletionAttempts)
        .get(),
    ).next;
    if (canceled !== null) times.push(canceled);
    return times.length
      ? Math.max(Temporal.Now.instant().epochMilliseconds + 1_000, Math.min(...times))
      : null;
  }
  pending() {
    return (
      this.database.select({ attemptId: deletionJobs.attemptId }).from(deletionJobs).limit(1).all()
        .length > 0
    );
  }
  receipts() {
    return this.database.select().from(deletionReceipts).all();
  }
  status() {
    return this.database
      .select({ json: deletionJobs.json })
      .from(deletionJobs)
      .all()
      .map((row) => {
        const job = jobSchema.parse(JSON.parse(row.json));
        return {
          attemptId: job.attemptId,
          accountId: job.accountId,
          state: job.state,
          identityDone: job.identityDone,
          accountDone: job.accountDone,
          failures: job.failures,
          overdue: Temporal.Now.instant().epochMilliseconds >= job.deadlineMs + DAY,
        };
      });
  }
  completedIdentities() {
    return this.database
      .select({ json: deletionJobs.json })
      .from(deletionJobs)
      .all()
      .map((row) => jobSchema.parse(JSON.parse(row.json)))
      .filter((job) => job.state === "erased")
      .map((job) => ({ subject: job.subject, accountId: job.accountId }));
  }

  recordGoogleRevocation(attemptId: string, subject: string, outcome: "revoked" | "failed") {
    const job = this.job(attemptId);
    if (!job || job.subject !== subject || job.state !== "scheduled") return;
    this.save({ ...job, googleRevocation: outcome });
  }

  private job(attemptId: string) {
    const row = this.database
      .select({ json: deletionJobs.json })
      .from(deletionJobs)
      .where(eq(deletionJobs.attemptId, attemptId))
      .get();
    return row ? jobSchema.parse(JSON.parse(row.json)) : undefined;
  }
  private save(job: DeletionJob) {
    this.database
      .insert(deletionJobs)
      .values({ attemptId: job.attemptId, json: JSON.stringify(job) })
      .onConflictDoUpdate({ target: deletionJobs.attemptId, set: { json: JSON.stringify(job) } })
      .run();
  }
  private enqueue(attempt: DeletionAttempt, type: string, subject: string, text: string) {
    const notification: Notification = {
      key: `${attempt.attemptId}:${type}`,
      email: attempt.email,
      subject,
      text,
      firstAttemptMs: null,
      nextAttemptMs: Temporal.Now.instant().epochMilliseconds,
      attempts: 0,
      state: "pending",
    };
    this.database
      .insert(deletionNotifications)
      .values({
        key: notification.key,
        attemptId: attempt.attemptId,
        json: JSON.stringify(notification),
      })
      .onConflictDoNothing()
      .run();
  }
  private cancelNotification(key: string) {
    const row = this.database
      .select({ json: deletionNotifications.json })
      .from(deletionNotifications)
      .where(eq(deletionNotifications.key, key))
      .get();
    if (!row) return;
    const notification = notificationSchema.parse(JSON.parse(row.json));
    if (notification.state === "pending")
      this.saveNotification({ ...notification, state: "canceled" });
  }
  private saveNotification(notification: Notification) {
    if (notification.state !== "pending")
      notification = { ...notification, email: "", text: "", subject: "" };
    this.database
      .update(deletionNotifications)
      .set({ json: JSON.stringify(notification) })
      .where(eq(deletionNotifications.key, notification.key))
      .run();
  }

  private async sendNotifications() {
    for (const row of this.database
      .select({ json: deletionNotifications.json })
      .from(deletionNotifications)
      .where(
        and(
          eq(sql<string>`json_extract(${deletionNotifications.json}, '$.state')`, "pending"),
          lte(
            sql<number>`json_extract(${deletionNotifications.json}, '$.nextAttemptMs')`,
            Temporal.Now.instant().epochMilliseconds,
          ),
        ),
      )
      .orderBy(
        asc(sql`json_extract(${deletionNotifications.json}, '$.nextAttemptMs')`),
        asc(deletionNotifications.key),
      )
      .limit(100)
      .all()) {
      const notification = notificationSchema.parse(JSON.parse(row.json));
      const nowMs = Temporal.Now.instant().epochMilliseconds;
      if (notification.state !== "pending" || notification.nextAttemptMs > nowMs) continue;
      if (
        notification.firstAttemptMs !== null &&
        nowMs >= notification.firstAttemptMs + 23 * 3_600_000
      ) {
        notification.state = "expired";
        this.saveNotification(notification);
        continue;
      }
      notification.firstAttemptMs ??= nowMs;
      notification.attempts += 1;
      this.saveNotification(notification); // Intent and window precede an ambiguous HTTP call.
      let retryAfterMs = 0;
      try {
        if (!this.env.RESEND_API_KEY) throw new Error("Email provider unavailable");
        const response = await this.request("https://api.resend.com/emails", {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
          headers: {
            Authorization: `Bearer ${this.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
            "Idempotency-Key": notification.key,
          },
          body: JSON.stringify({
            from: "Cup <no-reply@cup-audio.com>",
            to: [notification.email],
            subject: notification.subject,
            text: notification.text,
          }),
        });
        if (response.ok) notification.state = "sent";
        else if (
          response.status >= 400 &&
          response.status < 500 &&
          ![408, 409, 429].includes(response.status)
        )
          notification.state = "failed";
        else {
          const delay = response.headers.get("Retry-After");
          if (delay) retryAfterMs = providerRetryDelay(delay, nowMs);
        }
        await response.body?.cancel();
      } catch {
        /* The immutable key is replayed only inside its provider deduplication window. */
      }
      notification.nextAttemptMs =
        nowMs +
        Math.max(
          retryAfterMs,
          Math.min(3_600_000, 60_000 * 2 ** Math.min(notification.attempts - 1, 6)) +
            Math.floor(Math.random() * 5_000),
        );
      notification.nextAttemptMs = Math.min(
        notification.nextAttemptMs,
        notification.firstAttemptMs + 23 * 3_600_000,
      );
      this.saveNotification(notification);
    }
  }

  private receiptIfFinished(job: DeletionJob, result: string) {
    const notifications = this.database
      .select({ json: deletionNotifications.json })
      .from(deletionNotifications)
      .where(eq(deletionNotifications.attemptId, job.attemptId))
      .all()
      .map((row) => notificationSchema.parse(JSON.parse(row.json)));
    if (notifications.some((notification) => notification.state === "pending")) return;
    this.database.transaction(() => {
      if (result !== "restored")
        this.database
          .insert(deletionReceipts)
          .values({
            attemptId: job.attemptId,
            completedAtMs: Temporal.Now.instant().epochMilliseconds,
            expiresAtMs: Temporal.Now.instant().epochMilliseconds + 90 * DAY,
            result: JSON.stringify({
              result,
              accountId: job.accountId,
              supabaseUserId: job.subject,
              scheduledAtMs: job.scheduledAtMs,
              recoveryDeadlineMs: job.deadlineMs,
              completedAtMs: Temporal.Now.instant().epochMilliseconds,
              identityDeleted: job.identityDone,
              accountErased: job.accountDone,
              googleRevocation: job.googleRevocation,
              notifications: notifications.map((notification) => notification.state),
            }),
          })
          .onConflictDoNothing()
          .run();
      this.database
        .delete(deletionNotifications)
        .where(eq(deletionNotifications.attemptId, job.attemptId))
        .run();
      this.database.delete(deletionJobs).where(eq(deletionJobs.attemptId, job.attemptId)).run();
    });
  }
  private async deleteIdentity(subject: string) {
    if (!this.env.SUPABASE_URL || !this.env.SUPABASE_SECRET_KEY)
      throw new Error("Identity administration unavailable");
    const response = await this.request(`${this.env.SUPABASE_URL}/auth/v1/admin/users/${subject}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(10_000),
      headers: {
        apikey: this.env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${this.env.SUPABASE_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ should_soft_delete: false }),
    });
    await response.body?.cancel();
    if (!response.ok && response.status !== 404) throw new Error("Identity deletion unavailable");
  }
}

function providerRetryDelay(value: string, nowMs: number) {
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const match = /^[A-Za-z]{3}, (\d{2}) ([A-Za-z]{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(
    value,
  );
  if (!match) return 0;
  const month =
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(
      match[2]!,
    ) + 1;
  try {
    const date = Temporal.ZonedDateTime.from(
      {
        timeZone: "UTC",
        year: Number(match[3]),
        month,
        day: Number(match[1]),
        hour: Number(match[4]),
        minute: Number(match[5]),
        second: Number(match[6]),
      },
      { overflow: "reject" },
    );
    return Math.max(0, date.epochMilliseconds - nowMs);
  } catch {
    return 0;
  }
}
