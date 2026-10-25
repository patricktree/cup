import { generateMigrations } from "@cup/drizzle-migrations";

await generateMigrations({
  grant: ["storage/grant-sqlite-schema.ts", "storage/rate-limit-schema.ts"],
});
