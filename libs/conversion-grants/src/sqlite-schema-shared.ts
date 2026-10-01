import { integer, sqliteTable } from "drizzle-orm/sqlite-core";

export const schemaMigrations = sqliteTable("_schema_migrations", {
  version: integer().primaryKey(),
  appliedAtMs: integer("applied_at_ms").notNull(),
});
