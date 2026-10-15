import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const rateEvents = sqliteTable(
  "rate_events",
  {
    bucket: text().notNull(),
    eventId: text("event_id").primaryKey(),
    createdAtMs: integer("created_at_ms").notNull(),
    expiresAtMs: integer("expires_at_ms").notNull(),
  },
  (table) => [index("rate_events_bucket").on(table.bucket, table.createdAtMs)],
);
