import { sql } from "drizzle-orm";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";

import registryMigrations from "#src/migrations/registry.ts";

export function migrateRegistry<T extends Record<string, unknown>>(
  database: DrizzleSqliteDODatabase<T>,
) {
  return migrateWithLegacyReset(
    database,
    registryMigrations,
    3,
    [
      "DROP TABLE conversion_grants",
      "ALTER TABLE registry_grants RENAME TO legacy_registry_grants",
    ],
    [
      `INSERT INTO registry_grants (
      grant_id, request_id, label, phase, created_at_ms, expires_at_ms, credential_issued,
      projection_allowance_milliseconds, projection_revision, projection_revoked_at_ms,
      projection_reserved, projection_spent, projection_schema_version
    ) SELECT grant_id, request_id, label, phase, created_at_ms, expires_at_ms, credential_issued,
      projection_allowance_milliseconds, projection_revision + 1, projection_revoked_at_ms,
      CASE WHEN projection_revision IS NOT NULL THEN 0 END,
      CASE WHEN projection_revision IS NOT NULL THEN 0 END,
      CASE WHEN projection_revision IS NOT NULL THEN 6 END
    FROM legacy_registry_grants`,
      "DROP TABLE legacy_registry_grants",
    ],
  );
}

function migrateWithLegacyReset<T extends Record<string, unknown>>(
  database: DrizzleSqliteDODatabase<T>,
  migrations: typeof registryMigrations,
  legacyVersion: number,
  beforeBaseline: string[],
  afterBaseline: string[],
) {
  const legacy = database.get(sql`SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = '_schema_migrations'`);
  if (legacy === undefined) return migrate(database, migrations);

  const version = database.get<{ version: number }>(
    sql`SELECT MAX(version) AS version FROM _schema_migrations`,
  );
  if (version?.version !== legacyVersion)
    throw new Error(`Expected legacy registry schema version ${legacyVersion}; refusing to reset`);
  const drizzleJournal = database.get(sql`SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = '__drizzle_migrations'`);
  if (drizzleJournal !== undefined)
    throw new Error("Both legacy and Drizzle migration histories exist; refusing to reset");

  // Drizzle executes the reset, baseline, preserved rows, and journal write in one transaction.
  // Removing the legacy journal makes the destructive transition run exactly once.
  return migrate(database, {
    ...migrations,
    migrations: {
      ...migrations.migrations,
      m0000: [
        ...beforeBaseline,
        migrations.migrations.m0000,
        ...afterBaseline,
        "DROP TABLE _schema_migrations",
      ].join("\n--> statement-breakpoint\n"),
    },
  });
}
