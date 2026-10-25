import { generateMigrations } from "@cup/drizzle-migrations";

await generateMigrations({
  registry: ["storage/registry-sqlite-schema.ts", "storage/rate-limit-schema.ts"],
});
