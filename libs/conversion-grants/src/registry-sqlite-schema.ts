import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { schemaMigrations } from "#src/sqlite-schema-shared.ts";

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

export const conversionGrants = sqliteTable("conversion_grants", {
  conversionId: text("conversion_id").primaryKey(),
  grantId: text("grant_id")
    .notNull()
    .references(() => registryGrants.grantId),
});

export const registrySqliteSchema = { conversionGrants, registryGrants, schemaMigrations };
