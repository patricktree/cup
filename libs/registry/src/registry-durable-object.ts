import { DurableObject } from "cloudflare:workers";
import { and, eq, lte, min, sql } from "drizzle-orm";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";

import type { AccountSnapshot } from "@cup/accounts";
import type { DeletionAttempt } from "@cup/accounts/lifecycle";
import { RollingLimits } from "@cup/accounts/rolling-limits";
import { conversionOwnerSchema, type ConversionOwner } from "@cup/conversion-contracts";
import type {
  ListGrantsResult,
  ProjectedGrantState,
  GrantRegistrySnapshot,
} from "@cup/conversion-grants";

import { DeletionCoordinator, type DeletionEnvironment } from "#src/deletion-coordinator.ts";
import {
  applyGrantRegistrySnapshot,
  decodeCursor,
  deriveProjectedState,
  encodeCursor,
  GRANT_LIFETIME_MS,
  REGISTRY_SCHEMA_VERSION,
  type RegistryEntry,
} from "#src/registry-model.ts";
import { toOperatorFacts } from "#src/registry-model.ts";
import { identityAccounts, provisioningJobs } from "#src/registry-sqlite-schema.ts";
import { RegistrySqlite } from "#src/registry-sqlite.ts";
import { requireRow } from "#src/sqlite-row.ts";
import { verifySupabaseIdentity } from "#src/supabase-identity.ts";

export type IdentityAccount = {
  subject: string;
  accountId: string;
  createdAtMs: number;
  phase: "provisioning" | "active" | "deleting_identity";
};

type RegistryEnvironment = DeletionEnvironment & {
  SIGNUP_IP_LIMIT?: string;
  CONVERSION_IP_LIMIT?: string;
};

/** Supabase identity verification belongs to the authenticated API, before registry allocation. */
export class RegistryDurableObject extends DurableObject<RegistryEnvironment> {
  private readonly sqlite: RegistrySqlite;
  private readonly database: DrizzleSqliteDODatabase;
  private readonly deletions: DeletionCoordinator;
  private readonly limits: RollingLimits;
  constructor(context: DurableObjectState, env: RegistryEnvironment) {
    super(context, env);
    this.database = drizzle(context.storage);
    this.sqlite = new RegistrySqlite(context.storage);

    void context.blockConcurrencyWhile(() => this.sqlite.applyMigrations());
    this.deletions = new DeletionCoordinator(context.storage, env);
    this.limits = new RollingLimits(context.storage);
  }

  reserveVerifiedIdentity(
    subject: string,
    nowMs = Temporal.Now.instant().epochMilliseconds,
  ): IdentityAccount {
    z.uuid().parse(subject);
    z.number().int().nonnegative().safe().parse(nowMs);
    return this.database.transaction(() => {
      const existing = this.findIdentity(subject);
      if (existing !== undefined) {
        if (existing.phase === "deleting_identity") throw new Error("Identity deletion is pending");
        return existing;
      }
      const identity: IdentityAccount = {
        subject,
        accountId: crypto.randomUUID(),
        createdAtMs: nowMs,
        phase: "provisioning",
      };
      this.database.insert(identityAccounts).values(identity).run();
      return identity;
    });
  }

  async provisionVerifiedIdentity(
    subject: string,
    nowMs = Temporal.Now.instant().epochMilliseconds,
  ): Promise<AccountSnapshot> {
    const existing = this.findIdentity(subject);
    if (!existing && this.env.SUPABASE_URL && !(await verifySupabaseIdentity(this.env, subject)))
      throw new Error("Supabase identity no longer exists");
    await this.ctx.storage.setAlarm(Temporal.Now.instant().epochMilliseconds + 60_000);
    const identity = this.reserveVerifiedIdentity(subject, nowMs);
    this.database
      .insert(provisioningJobs)
      .values({
        subject,
        attempts: 0,
        nextAttemptMs: Temporal.Now.instant().epochMilliseconds + 60_000,
      })
      .onConflictDoNothing()
      .run();
    const account = this.env.ACCOUNTS.get(this.env.ACCOUNTS.idFromName(identity.accountId));
    const snapshot = await account.initialize({
      subject,
      accountId: identity.accountId,
      createdAtMs: identity.createdAtMs,
    });
    if (this.env.SUPABASE_URL && !(await verifySupabaseIdentity(this.env, subject)))
      throw new Error("Supabase identity no longer exists");
    this.database.transaction(() => {
      const current = this.findIdentity(subject);
      if (current?.accountId !== identity.accountId || current.phase === "deleting_identity")
        throw new Error("Account provisioning was fenced by identity deletion");
      this.database
        .update(identityAccounts)
        .set({ phase: "active" })
        .where(eq(identityAccounts.subject, subject))
        .run();
    });
    this.database.delete(provisioningJobs).where(eq(provisioningJobs.subject, subject)).run();
    return snapshot;
  }

  override async alarm() {
    await this.ctx.storage.setAlarm(Temporal.Now.instant().epochMilliseconds + 60_000);
    const jobs = this.database
      .select({ subject: provisioningJobs.subject, attempts: provisioningJobs.attempts })
      .from(provisioningJobs)
      .where(lte(provisioningJobs.nextAttemptMs, Temporal.Now.instant().epochMilliseconds))
      .all();
    for (const job of jobs) {
      try {
        if (this.findIdentity(job.subject)?.phase === "deleting_identity") {
          this.database
            .delete(provisioningJobs)
            .where(eq(provisioningJobs.subject, job.subject))
            .run();
          continue;
        }
        await this.provisionVerifiedIdentity(job.subject);
      } catch {
        const delay = Math.min(300_000, 60_000 * 2 ** Math.min(job.attempts, 3));
        this.database
          .update(provisioningJobs)
          .set({
            attempts: sql`${provisioningJobs.attempts} + 1`,
            nextAttemptMs:
              Temporal.Now.instant().epochMilliseconds + delay + Math.floor(Math.random() * 5_000),
          })
          .where(eq(provisioningJobs.subject, job.subject))
          .run();
      }
    }
    await this.deletions.reconcile(
      (subject, accountId) => this.fenceIdentityDeletion(subject, accountId),
      (subject, accountId) => {
        this.database
          .delete(identityAccounts)
          .where(
            and(
              eq(identityAccounts.subject, subject),
              eq(identityAccounts.accountId, accountId),
              eq(identityAccounts.phase, "deleting_identity"),
            ),
          )
          .run();
      },
    );
    const provisioningNext = requireRow(
      this.database
        .select({ next: min(provisioningJobs.nextAttemptMs) })
        .from(provisioningJobs)
        .get(),
    ).next;
    this.limits.expire(Temporal.Now.instant().epochMilliseconds);
    const candidates = [this.deletions.nextAlarm(), this.limits.nextAlarm()].filter(
      (time): time is number => time !== null,
    );
    const deletionNext = candidates.length ? Math.min(...candidates) : null;
    const next =
      provisioningNext === null
        ? deletionNext
        : deletionNext === null
          ? provisioningNext
          : Math.min(provisioningNext, deletionNext);
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }

  async consumeIngressRequest(key: string) {
    z.string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(key);
    await this.ctx.storage.setAlarm(Temporal.Now.instant().epochMilliseconds + 60_000);
    return this.limits.consume(
      `conversion-ip:${key}`,
      this.env.CONVERSION_IP_LIMIT ? Number(this.env.CONVERSION_IP_LIMIT) : 60,
      60_000,
      Temporal.Now.instant().epochMilliseconds,
    );
  }
  async provisionFromIngress(subject: string, key: string) {
    z.uuid().parse(subject);
    z.string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(key);
    if (
      !this.findIdentity(subject) &&
      this.env.SUPABASE_URL &&
      !(await verifySupabaseIdentity(this.env, subject))
    )
      throw new Error("Identity unavailable");
    await this.ctx.storage.setAlarm(Temporal.Now.instant().epochMilliseconds + 60_000);
    const retryAfter = this.database.transaction(() => {
      if (this.findIdentity(subject)) return 0;
      const limited = this.limits.consume(
        `signup-ip:${key}`,
        this.env.SIGNUP_IP_LIMIT ? Number(this.env.SIGNUP_IP_LIMIT) : 10,
        3_600_000,
        Temporal.Now.instant().epochMilliseconds,
      );
      if (!limited) this.reserveVerifiedIdentity(subject);
      return limited;
    });
    if (retryAfter) return { result: "rate-limited" as const, retryAfter };
    return {
      result: "provisioned" as const,
      snapshot: await this.provisionVerifiedIdentity(subject),
    };
  }

  async acceptDeletionAttempt(attempt: DeletionAttempt) {
    const identity = this.findIdentity(attempt.subject);
    if (identity?.accountId !== attempt.accountId)
      throw new Error("Deletion account identity mismatch");
    const account = this.env.ACCOUNTS.get(this.env.ACCOUNTS.idFromName(attempt.accountId));
    if ((await account.deletionAttemptState(attempt.attemptId)) !== attempt.state) return;
    await this.deletions.accept(attempt);
  }
  inspectDeletions() {
    return this.deletions.status();
  }
  recordGoogleRevocation(attemptId: string, subject: string, outcome: "revoked" | "failed") {
    this.deletions.recordGoogleRevocation(attemptId, subject, outcome);
  }
  deletionReceipts() {
    return this.deletions.receipts();
  }

  findIdentity(subject: string): IdentityAccount | undefined {
    return this.database
      .select()
      .from(identityAccounts)
      .where(eq(identityAccounts.subject, subject))
      .get();
  }

  fenceIdentityDeletion(subject: string, accountId: string): void {
    this.database.transaction(() => {
      const identity = this.findIdentity(subject);
      if (identity?.accountId !== accountId) throw new Error("Identity ownership mismatch");
      this.database
        .update(identityAccounts)
        .set({ phase: "deleting_identity" })
        .where(eq(identityAccounts.subject, subject))
        .run();
    });
  }

  async reserveProvisioning(
    requestId: string,
    label: string,
    nowMs = Temporal.Now.instant().epochMilliseconds,
  ): Promise<{ entry: RegistryEntry; created: boolean }> {
    return this.ctx.storage.transaction(async () => {
      const registry = await this.sqlite.load();
      const existing = registry.grants.find((entry) => entry.requestId === requestId);
      if (existing !== undefined) {
        if (existing.label !== label)
          throw new Error("Provisioning request ID is already bound to a different label");
        return { entry: existing, created: false };
      }
      const entry: RegistryEntry = {
        requestId,
        grantId: crypto.randomUUID(),
        label,
        phase: "reserved",
        createdAtMs: nowMs,
        expiresAtMs: nowMs + GRANT_LIFETIME_MS,
        credentialIssued: false,
      };
      registry.grants.push(entry);
      await this.sqlite.save(registry);
      return { entry, created: true };
    });
  }

  async activate(
    requestId: string,
    grantSnapshot: GrantRegistrySnapshot,
    credentialIssued: boolean,
  ): Promise<RegistryEntry> {
    return this.ctx.storage.transaction(async () => {
      const registry = await this.sqlite.load();
      const entry = registry.grants.find((item) => item.requestId === requestId);
      if (entry === undefined) throw new Error("Provisioning request does not exist");
      entry.phase = "active";
      entry.credentialIssued ||= credentialIssued;
      applyGrantRegistrySnapshot(entry, grantSnapshot);
      await this.sqlite.save(registry);
      return entry;
    });
  }

  async applyGrantRegistrySnapshot(
    grantSnapshot: GrantRegistrySnapshot,
  ): Promise<"applied" | "replayed" | "stale"> {
    return this.ctx.storage.transaction(async () => {
      const registry = await this.sqlite.load();
      const entry = registry.grants.find((item) => item.grantId === grantSnapshot.grantId);
      if (entry === undefined) throw new Error("Registry grant does not exist");
      const result = applyGrantRegistrySnapshot(entry, grantSnapshot);
      await this.sqlite.save(registry);
      return result;
    });
  }

  async getGrant(grantId: string): Promise<RegistryEntry | undefined> {
    return (await this.sqlite.load()).grants.find((entry) => entry.grantId === grantId);
  }

  async listGrants(
    input: { label?: string; state?: ProjectedGrantState; limit: number; cursor?: string },
    nowMs = Temporal.Now.instant().epochMilliseconds,
  ): Promise<ListGrantsResult> {
    const registry = await this.sqlite.load();
    const after = input.cursor === undefined ? undefined : decodeCursor(input.cursor);
    const matches = registry.grants
      .filter(
        (entry) =>
          input.label === undefined ||
          entry.label.toLocaleLowerCase().includes(input.label.toLocaleLowerCase()),
      )
      .filter(
        (entry) => input.state === undefined || deriveProjectedState(entry, nowMs) === input.state,
      )
      .sort(
        (left, right) =>
          left.createdAtMs - right.createdAtMs || left.grantId.localeCompare(right.grantId),
      )
      .filter(
        (entry) =>
          after === undefined ||
          entry.createdAtMs > after.createdAtMs ||
          (entry.createdAtMs === after.createdAtMs && entry.grantId > after.grantId),
      );
    const page = matches.slice(0, input.limit);
    const last = page.at(-1);
    return {
      grants: page.map((entry) => toOperatorFacts(entry, nowMs)),
      ...(matches.length > page.length && last !== undefined
        ? { nextCursor: encodeCursor(last) }
        : {}),
    };
  }

  async enumerateGrantIds(): Promise<string[]> {
    return (await this.sqlite.load()).grants.map((entry) => entry.grantId);
  }

  async bindConversion(conversionId: string, grantId: string): Promise<void> {
    await this.ctx.storage.transaction(async () => {
      const owner = await this.findConversionOwner(conversionId);
      if (owner !== undefined && (owner.kind !== "trial" || owner.grantId !== grantId))
        throw new Error("Conversion identity is already bound to a different owner");
      const registry = await this.sqlite.load();
      if (!registry.grants.some((entry) => entry.grantId === grantId))
        throw new Error("Conversion grant is not registered");

      this.saveConversionOwner(conversionId, { kind: "trial", grantId });
    });
  }

  async findGrantIdForConversion(conversionId: string): Promise<string | undefined> {
    const owner = await this.findConversionOwner(conversionId);
    return owner?.kind === "trial" ? owner.grantId : undefined;
  }

  async bindConversionOwner(conversionId: string, owner: ConversionOwner): Promise<void> {
    z.uuidv4().parse(conversionId);
    const parsed = conversionOwnerSchema.parse(owner);
    await this.ctx.storage.transaction(async () => {
      const existing = await this.findConversionOwner(conversionId);
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(parsed))
        throw new Error("Conversion identity is already bound to a different owner");
      this.saveConversionOwner(conversionId, parsed);
    });
  }

  async findConversionOwner(conversionId: string): Promise<ConversionOwner | undefined> {
    const row = this.sqlite.findConversionOwner(conversionId);
    if (row !== undefined)
      return conversionOwnerSchema.parse(
        row.kind === "trial"
          ? { kind: row.kind, grantId: row.grantId }
          : { kind: row.kind, accountId: row.accountId },
      );
    return undefined;
  }

  private saveConversionOwner(conversionId: string, owner: ConversionOwner): void {
    this.sqlite.saveConversionOwner(conversionId, owner);
  }

  removeAccountConversionOwners(accountId: string) {
    z.uuidv4().parse(accountId);
    this.sqlite.removeAccountConversionOwners(accountId);
  }

  async migrate(): Promise<number> {
    await this.sqlite.applyMigrations();
    return REGISTRY_SCHEMA_VERSION;
  }
}
