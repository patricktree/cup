import { generateMigrations } from "@cup/drizzle-migrations";

await generateMigrations({
  grant: ["grant-sqlite-schema.ts", "rate-limit-schema.ts"],
});
