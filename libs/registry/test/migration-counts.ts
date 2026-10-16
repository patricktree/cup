import fs from "node:fs/promises";
import { createRequire } from "node:module";
import nodeUrl from "node:url";
import { z } from "zod";

import registryMigrations from "#src/migrations/registry.ts";

// Counted from the migrations, so tests that inspect `__drizzle_migrations` survive new or renumbered migrations.
export const registryMigrationCount = Object.keys(registryMigrations.migrations).length;

// @cup/conversion-grants does not export its migration bundle, so count the entries of its journal.
const grantJournal = z
  .object({ entries: z.array(z.unknown()) })
  .parse(
    JSON.parse(
      await fs.readFile(
        new URL(
          "drizzle/grant/meta/_journal.json",
          nodeUrl.pathToFileURL(
            createRequire(import.meta.url).resolve("@cup/conversion-grants/package.json"),
          ),
        ),
        "utf8",
      ),
    ),
  );
export const grantMigrationCount = grantJournal.entries.length;
