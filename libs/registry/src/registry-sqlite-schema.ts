import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const REGISTRY_PHASES = ["reserved", "initialized", "active"] as const;

export const registryGrants = sqliteTable(
  "registry_grants",
  {
    grantId: text("grant_id").primaryKey(),
    requestId: text("request_id").notNull().unique(),
    label: text().notNull(),
    phase: text({ enum: REGISTRY_PHASES }).notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    expiresAtMs: integer("expires_at_ms").notNull(),
    credentialIssued: integer("credential_issued", { mode: "boolean" }).notNull(),
    snapshotAllowanceMilliseconds: integer("projection_allowance_milliseconds")
      .notNull()
      .default(7_200_000),
    snapshotRevision: integer("projection_revision"),
    snapshotRevokedAtMs: integer("projection_revoked_at_ms"),
    snapshotReserved: integer("projection_reserved"),
    snapshotSpent: integer("projection_spent"),
    snapshotSchemaVersion: integer("projection_schema_version"),
  },
  (table) => [
    check("registry_grant_phase", sql`${table.phase} IN ('reserved', 'initialized', 'active')`),
    check("registry_grant_credential", sql`${table.credentialIssued} IN (0, 1)`),
    check("registry_grant_allowance", sql`${table.snapshotAllowanceMilliseconds} > 0`),
    check("registry_grant_expiry", sql`${table.expiresAtMs} > ${table.createdAtMs}`),
    check("registry_grant_snapshot_reserved", sql`${table.snapshotReserved} >= 0`),
    check("registry_grant_snapshot_spent", sql`${table.snapshotSpent} >= 0`),
    check(
      "registry_grant_snapshot",
      sql`(
        (${table.snapshotRevision} IS NULL AND ${table.snapshotReserved} IS NULL AND ${table.snapshotSpent} IS NULL AND ${table.snapshotSchemaVersion} IS NULL)
        OR (${table.snapshotRevision} > 0 AND ${table.snapshotReserved} IS NOT NULL AND ${table.snapshotSpent} IS NOT NULL AND ${table.snapshotSchemaVersion} > 0)
      )`,
    ),
  ],
);

export const conversionOwners = sqliteTable(
  "conversion_owners",
  {
    conversionId: text("conversion_id").primaryKey(),
    kind: text("owner_kind", { enum: ["trial", "account"] }).notNull(),
    grantId: text("grant_id"),
    accountId: text("account_id"),
  },
  (table) => [
    check("conversion_owner_kind", sql`${table.kind} IN ('trial', 'account')`),
    check(
      "conversion_owner_identity",
      sql`(${table.kind} = 'trial' AND ${table.grantId} IS NOT NULL AND ${table.accountId} IS NULL) OR (${table.kind} = 'account' AND ${table.accountId} IS NOT NULL AND ${table.grantId} IS NULL)`,
    ),
  ],
);

export const identityAccounts = sqliteTable(
  "identity_accounts",
  {
    subject: text().primaryKey(),
    accountId: text("account_id").notNull().unique(),
    createdAtMs: integer("created_at_ms").notNull(),
    phase: text({ enum: ["provisioning", "active", "deleting_identity"] }).notNull(),
  },
  (table) => [
    check(
      "identity_account_phase",
      sql`${table.phase} IN ('provisioning', 'active', 'deleting_identity')`,
    ),
  ],
);

export const provisioningJobs = sqliteTable("provisioning_jobs", {
  subject: text().primaryKey(),
  attempts: integer().notNull(),
  nextAttemptMs: integer("next_attempt_ms").notNull(),
});

export const deletionJobs = sqliteTable("deletion_jobs", {
  attemptId: text("attempt_id").primaryKey(),
  json: text("payload_json").notNull(),
});

export const deletionNotifications = sqliteTable("deletion_notifications", {
  key: text("notification_key").primaryKey(),
  attemptId: text("attempt_id").notNull(),
  json: text("payload_json").notNull(),
});

export const canceledDeletionAttempts = sqliteTable("canceled_deletion_attempts", {
  attemptId: text("attempt_id").primaryKey(),
  expiresAtMs: integer("expires_at_ms").notNull(),
});

export const deletionReceipts = sqliteTable("deletion_receipts", {
  attemptId: text("attempt_id").primaryKey(),
  completedAtMs: integer("completed_at_ms").notNull(),
  expiresAtMs: integer("expires_at_ms").notNull(),
  result: text("result_json").notNull(),
});

export const registrySqliteSchema = {
  registryGrants,
  conversionOwners,
  identityAccounts,
  provisioningJobs,
  deletionJobs,
  deletionNotifications,
  canceledDeletionAttempts,
  deletionReceipts,
};
