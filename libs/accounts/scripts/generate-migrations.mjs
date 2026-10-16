import { generateMigrations } from "@cup/drizzle-migrations";

await generateMigrations({
  account: ["account-sqlite-schema.ts", "rate-limit-schema.ts"],
});
