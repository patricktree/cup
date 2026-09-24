import { asc, desc, getTableColumns } from "drizzle-orm";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";

import type { RegistryEntry, RegistryRecord } from "#src/registry-model.ts";
import { REGISTRY_SCHEMA_VERSION } from "#src/registry-model.ts";
import {
  conversionGrants as conversionGrantTable,
  registryGrants as registryGrantTable,
  registrySqliteSchema,
  schemaMigrations,
} from "#src/sqlite-schema.ts";
import { nowMilliseconds } from "#src/time.ts";

// https://developers.cloudflare.com/durable-objects/platform/limits/
const MAX_SQL_PARAMETERS = 100;
const GRANTS_PER_BATCH = Math.floor(
  MAX_SQL_PARAMETERS / Object.keys(getTableColumns(registryGrantTable)).length,
);
const CONVERSIONS_PER_BATCH = Math.floor(
  MAX_SQL_PARAMETERS / Object.keys(getTableColumns(conversionGrantTable)).length,
);

export class ConversionGrantRegistrySqlite {
  private readonly database: DrizzleSqliteDODatabase<typeof registrySqliteSchema>;
  private readonly storage: DurableObjectStorage;

  constructor(storage: DurableObjectStorage) {
    this.database = drizzle(storage, { schema: registrySqliteSchema });
    this.storage = storage;
  }

  async applyMigrations(): Promise<void> {
    this.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS _schema_migrations (version INTEGER PRIMARY KEY, applied_at_ms INTEGER NOT NULL)",
    );
    const latest =
      this.database
        .select({ version: schemaMigrations.version })
        .from(schemaMigrations)
        .orderBy(desc(schemaMigrations.version))
        .limit(1)
        .get()?.version ?? 0;
    if (latest > REGISTRY_SCHEMA_VERSION)
      throw new Error("Registry schema is newer than this Worker");
    if (latest < 1) {
      this.storage.transactionSync(() => {
        this.storage.sql.exec(
          `CREATE TABLE registry_grants (
            grant_id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL UNIQUE,
            label TEXT NOT NULL,
            phase TEXT NOT NULL CHECK (phase IN ('reserved', 'initialized', 'active')),
            created_at_ms INTEGER NOT NULL,
            expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > created_at_ms),
            credential_issued INTEGER NOT NULL CHECK (credential_issued IN (0, 1)),
            projection_revision INTEGER,
            projection_revoked_at_ms INTEGER,
            projection_reserved INTEGER CHECK (projection_reserved BETWEEN 0 AND 5),
            projection_spent INTEGER CHECK (projection_spent BETWEEN 0 AND 5),
            projection_schema_version INTEGER,
            CHECK (
              (projection_revision IS NULL AND projection_reserved IS NULL AND projection_spent IS NULL AND projection_schema_version IS NULL)
              OR (projection_revision > 0 AND projection_reserved IS NOT NULL AND projection_spent IS NOT NULL AND projection_schema_version > 0)
            )
          )`,
        );
        this.storage.sql.exec(
          `CREATE TABLE conversion_grants (
            conversion_id TEXT PRIMARY KEY,
            grant_id TEXT NOT NULL REFERENCES registry_grants(grant_id)
          )`,
        );
        this.database
          .insert(schemaMigrations)
          .values({ version: 1, appliedAtMs: nowMilliseconds() })
          .run();
      });
    }
    if (latest < 2) {
      this.storage.transactionSync(() => {
        this.storage.sql.exec(`CREATE TABLE registry_grants_new (
            grant_id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL UNIQUE,
            label TEXT NOT NULL,
            phase TEXT NOT NULL CHECK (phase IN ('reserved', 'initialized', 'active')),
            created_at_ms INTEGER NOT NULL,
            expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > created_at_ms),
            credential_issued INTEGER NOT NULL CHECK (credential_issued IN (0, 1)),
            projection_revision INTEGER,
            projection_revoked_at_ms INTEGER,
            projection_reserved INTEGER CHECK (projection_reserved >= 0),
            projection_spent INTEGER CHECK (projection_spent >= 0),
            projection_schema_version INTEGER,
            CHECK (
              (projection_revision IS NULL AND projection_reserved IS NULL AND projection_spent IS NULL AND projection_schema_version IS NULL)
              OR (projection_revision > 0 AND projection_reserved IS NOT NULL AND projection_spent IS NOT NULL AND projection_schema_version > 0)
            )
          )`);
        this.storage.sql.exec("INSERT INTO registry_grants_new SELECT * FROM registry_grants");
        this.storage.sql.exec(
          "ALTER TABLE registry_grants_new ADD COLUMN projection_max_slots INTEGER NOT NULL DEFAULT 5 CHECK (projection_max_slots > 0)",
        );
        this.storage.sql.exec(
          "CREATE TABLE conversion_grants_backup AS SELECT * FROM conversion_grants",
        );
        this.storage.sql.exec("DROP TABLE conversion_grants");
        this.storage.sql.exec("DROP TABLE registry_grants");
        this.storage.sql.exec("ALTER TABLE registry_grants_new RENAME TO registry_grants");
        this.storage.sql.exec(
          "CREATE TABLE conversion_grants (conversion_id TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES registry_grants(grant_id))",
        );
        this.storage.sql.exec(
          "INSERT INTO conversion_grants SELECT * FROM conversion_grants_backup",
        );
        this.storage.sql.exec("DROP TABLE conversion_grants_backup");
        this.database
          .insert(schemaMigrations)
          .values({ version: 2, appliedAtMs: nowMilliseconds() })
          .run();
      });
    }
  }

  async load(): Promise<RegistryRecord> {
    const grants = this.database
      .select()
      .from(registryGrantTable)
      .orderBy(asc(registryGrantTable.createdAtMs), asc(registryGrantTable.grantId))
      .all()
      .map((row) => ({
        requestId: row.requestId,
        grantId: row.grantId,
        label: row.label,
        phase: row.phase,
        createdAtMs: row.createdAtMs,
        expiresAtMs: row.expiresAtMs,
        credentialIssued: row.credentialIssued,
        ...(row.snapshotRevision === null ||
        row.snapshotReserved === null ||
        row.snapshotSpent === null ||
        row.snapshotSchemaVersion === null
          ? {}
          : {
              grantSnapshot: {
                grantId: row.grantId,
                revision: row.snapshotRevision,
                maxSlots: row.snapshotMaxSlots,
                ...(row.snapshotRevokedAtMs === null
                  ? {}
                  : { revokedAtMs: row.snapshotRevokedAtMs }),
                reserved: row.snapshotReserved,
                spent: row.snapshotSpent,
                schemaVersion: row.snapshotSchemaVersion,
              },
            }),
      }));
    const conversionGrants = Object.fromEntries(
      this.database
        .select()
        .from(conversionGrantTable)
        .all()
        .map((row) => [row.conversionId, row.grantId]),
    );
    const parsed: unknown = { grants, conversionGrants };
    if (!isRegistryRecord(parsed)) throw new Error("Registry storage is corrupt");
    return parsed;
  }

  async save(record: RegistryRecord): Promise<void> {
    // Callers hold a storage transaction across these deletes and every insert batch.
    this.database.delete(conversionGrantTable).run();
    this.database.delete(registryGrantTable).run();
    for (let offset = 0; offset < record.grants.length; offset += GRANTS_PER_BATCH)
      this.database
        .insert(registryGrantTable)
        .values(
          record.grants.slice(offset, offset + GRANTS_PER_BATCH).map((entry) => ({
            grantId: entry.grantId,
            requestId: entry.requestId,
            label: entry.label,
            phase: entry.phase,
            createdAtMs: entry.createdAtMs,
            expiresAtMs: entry.expiresAtMs,
            credentialIssued: entry.credentialIssued,
            snapshotRevision: entry.grantSnapshot?.revision ?? null,
            snapshotMaxSlots: entry.grantSnapshot?.maxSlots ?? 5,
            snapshotRevokedAtMs: entry.grantSnapshot?.revokedAtMs ?? null,
            snapshotReserved: entry.grantSnapshot?.reserved ?? null,
            snapshotSpent: entry.grantSnapshot?.spent ?? null,
            snapshotSchemaVersion: entry.grantSnapshot?.schemaVersion ?? null,
          })),
        )
        .run();
    const conversionGrantEntries = Object.entries(record.conversionGrants);
    for (let offset = 0; offset < conversionGrantEntries.length; offset += CONVERSIONS_PER_BATCH)
      this.database
        .insert(conversionGrantTable)
        .values(
          conversionGrantEntries
            .slice(offset, offset + CONVERSIONS_PER_BATCH)
            .map(([conversionId, grantId]) => ({ conversionId, grantId })),
        )
        .run();
  }
}

function isRegistryRecord(value: unknown): value is RegistryRecord {
  return (
    isRecord(value) &&
    Array.isArray(value["grants"]) &&
    value["grants"].every(isRegistryEntry) &&
    isRecord(value["conversionGrants"]) &&
    Object.values(value["conversionGrants"]).every((grantId) => typeof grantId === "string")
  );
}

function isRegistryEntry(value: unknown): value is RegistryEntry {
  return (
    isRecord(value) &&
    typeof value["requestId"] === "string" &&
    typeof value["grantId"] === "string" &&
    typeof value["label"] === "string" &&
    (value["phase"] === "reserved" ||
      value["phase"] === "initialized" ||
      value["phase"] === "active") &&
    typeof value["createdAtMs"] === "number" &&
    typeof value["expiresAtMs"] === "number" &&
    typeof value["credentialIssued"] === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
