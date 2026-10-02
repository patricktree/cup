import { sql } from "drizzle-orm";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";

import grantMigrations from "#src/migrations/grant.ts";

export function migrateLegacyGrant<T extends Record<string, unknown>>(
  database: DrizzleSqliteDODatabase<T>,
) {
  return migrateWithLegacyReset(
    database,
    grantMigrations,
    5,
    [
      "DROP TABLE segment_usage",
      "DROP TABLE conversions",
      "DROP TABLE start_attempts",
      "ALTER TABLE grant RENAME TO legacy_grant",
    ],
    [
      `INSERT INTO grant (
      id, allowance_milliseconds, grant_id, created_at_ms, expires_at_ms,
      revoked_at_ms, credential_verifier, credential_issued_at_ms, session_signing_key,
      signing_key_generation, projection_revision, registry_confirmed_revision
    ) SELECT id, allowance_milliseconds, grant_id, created_at_ms, expires_at_ms,
      revoked_at_ms, credential_verifier, credential_issued_at_ms, session_signing_key,
      signing_key_generation, projection_revision + 1, registry_confirmed_revision
    FROM legacy_grant`,
      "DROP TABLE legacy_grant",
    ],
  );
}

function migrateWithLegacyReset<T extends Record<string, unknown>>(
  database: DrizzleSqliteDODatabase<T>,
  migrations: typeof grantMigrations,
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
    throw new Error(`Expected legacy grant schema version ${legacyVersion}; refusing to reset`);
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
