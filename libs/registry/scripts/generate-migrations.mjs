import { generateMigrations } from "@cup/drizzle-migrations";

await generateMigrations({
  registry: ["registry-sqlite-schema.ts", "rate-limit-schema.ts"],
});
