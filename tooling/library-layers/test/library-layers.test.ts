import { parse } from "jsonc-parser";
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { z } from "zod";

import { findLayerConfigProblems, type LibraryTags } from "#src/library-layers.ts";

const REPOSITORY_ROOT = path.join(import.meta.dirname, "../../..");
const LIBS_DIRECTORY = path.join(REPOSITORY_ROOT, "libs");

const rootTurboConfigSchema = z.object({
  boundaries: z.object({
    tags: z.record(
      z.string(),
      z.object({ dependencies: z.object({ deny: z.array(z.string()).optional() }).optional() }),
    ),
  }),
});
const libraryTurboConfigSchema = z.object({ tags: z.array(z.string()).optional() });

async function readJsonc(filePath: string): Promise<unknown> {
  return parse(await fs.readFile(filePath, "utf8"));
}

async function readLibraryTags(): Promise<LibraryTags[]> {
  const directories = await fs.readdir(LIBS_DIRECTORY, { withFileTypes: true });
  const libraries: LibraryTags[] = [];
  for (const directory of directories.filter((entry) => entry.isDirectory())) {
    const config = libraryTurboConfigSchema.parse(
      await readJsonc(path.join(LIBS_DIRECTORY, directory.name, "turbo.jsonc")),
    );
    libraries.push({ library: directory.name, tags: config.tags ?? [] });
  }
  return libraries;
}

const THREE_LAYERS = {
  "layer:bottom": { dependencies: { deny: ["layer:bottom", "layer:middle", "layer:top"] } },
  "layer:middle": { dependencies: { deny: ["layer:middle", "layer:top"] } },
  "layer:top": { dependencies: { deny: ["layer:top"] } },
};

test("every library has one layer tag and the deny lists form a stack", async () => {
  const rootConfig = rootTurboConfigSchema.parse(
    await readJsonc(path.join(REPOSITORY_ROOT, "turbo.jsonc")),
  );

  expect(findLayerConfigProblems(rootConfig.boundaries.tags, await readLibraryTags())).toEqual([]);
});

test("a library without a layer tag is reported", () => {
  expect(findLayerConfigProblems(THREE_LAYERS, [{ library: "new-library", tags: [] }])).toEqual([
    "`new-library` has 0 layer tags; give its `turbo.jsonc` exactly one of: layer:bottom, layer:middle, layer:top.",
  ]);
});

test("a library with an undeclared layer tag is reported", () => {
  expect(
    findLayerConfigProblems(THREE_LAYERS, [{ library: "accounts", tags: ["layer:owner"] }]),
  ).toEqual([
    "`accounts` has the tag `layer:owner`, which the root `turbo.jsonc` does not declare.",
  ]);
});

test("a deny list that misses a higher layer is reported", () => {
  const tagRules = {
    ...THREE_LAYERS,
    "layer:middle": { dependencies: { deny: ["layer:middle"] } },
  };

  expect(findLayerConfigProblems(tagRules, [])).toEqual([
    "`layer:middle` denies [layer:middle] but must deny its own tag and every layer above it, in order: [layer:middle, layer:top].",
  ]);
});

test("tags outside the layers are ignored", () => {
  const tagRules = { ...THREE_LAYERS, internal: { dependencies: { deny: ["public"] } } };

  expect(
    findLayerConfigProblems(tagRules, [{ library: "registry", tags: ["layer:top", "internal"] }]),
  ).toEqual([]);
});
