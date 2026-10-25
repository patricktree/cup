import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";

import accountMigrations from "#src/migrations/account.ts";

export function migrateAccount<T extends Record<string, unknown>>(
  database: DrizzleSqliteDODatabase<T>,
) {
  return migrate(database, accountMigrations);
}
