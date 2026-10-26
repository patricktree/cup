import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { z } from "zod";

import { findLayerViolations, LIBRARY_LAYERS, type LibraryManifest } from "#src/library-layers.ts";

const LIBS_DIRECTORY = path.join(import.meta.dirname, "../../../libs");

const manifestSchema = z.object({
  name: z.string(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

async function readLibraryManifests(): Promise<LibraryManifest[]> {
  const directories = await fs.readdir(LIBS_DIRECTORY, { withFileTypes: true });
  const manifests: LibraryManifest[] = [];
  for (const directory of directories.filter((entry) => entry.isDirectory())) {
    const manifestPath = path.join(LIBS_DIRECTORY, directory.name, "package.json");
    manifests.push(manifestSchema.parse(JSON.parse(await fs.readFile(manifestPath, "utf8"))));
  }
  return manifests;
}

test("every library depends only on libraries in lower layers", async () => {
  expect(findLayerViolations(await readLibraryManifests())).toEqual([]);
});

test("an owner depending on the registry is reported", () => {
  const manifests: LibraryManifest[] = [
    { name: "@cup/registry", dependencies: { "@cup/accounts": "workspace:*" } },
    { name: "@cup/accounts", dependencies: { "@cup/registry": "workspace:*" } },
  ];

  expect(findLayerViolations(manifests)).toEqual([
    "`@cup/accounts` (owners) depends on `@cup/registry` (coordination and API contracts); a library may depend only on libraries in lower layers.",
  ]);
});

test("a dependency between two libraries of the same layer is reported", () => {
  const manifests: LibraryManifest[] = [
    { name: "@cup/accounts", devDependencies: { "@cup/conversion-grants": "workspace:*" } },
    { name: "@cup/conversion-grants" },
  ];

  expect(findLayerViolations(manifests)).toEqual([
    "`@cup/accounts` (owners) depends on `@cup/conversion-grants` (owners); a library may depend only on libraries in lower layers.",
  ]);
});

test("a library without a layer is reported", () => {
  expect(findLayerViolations([{ name: "@cup/new-library" }])).toEqual([
    "`@cup/new-library` has no layer; add it to `LIBRARY_LAYERS` in `tooling/library-layers/src/library-layers.ts`.",
  ]);
});

test("dependencies outside `libs/` are not checked", () => {
  const manifests: LibraryManifest[] = [
    { name: "@cup/registry", devDependencies: { "@cup/resend-stub": "workspace:*", zod: "^4" } },
  ];

  expect(findLayerViolations(manifests)).toEqual([]);
});

test("each library has exactly one layer", () => {
  const names = LIBRARY_LAYERS.flatMap((layer) => layer.libraries);

  expect(new Set(names).size).toBe(names.length);
});
