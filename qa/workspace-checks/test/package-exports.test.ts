import childProcess from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { z } from "zod";

import { findPackageExportProblems, type WorkspaceProject } from "#src/package-exports.ts";

const REPOSITORY_ROOT = path.join(import.meta.dirname, "../../..");

const pnpmProjectListSchema = z.array(z.object({ name: z.string(), path: z.string() }));
const manifestSchema = z.object({
  // A conditional target without `default` fails here; extend ExportsField when a package needs one.
  exports: z
    .union([
      z.string(),
      z.record(
        z.string(),
        z.union([z.string(), z.object({ default: z.string() }).catchall(z.string())]),
      ),
    ])
    .optional(),
  cup: z
    .object({ subpathExportExceptions: z.record(z.string(), z.string().min(1)).optional() })
    .optional(),
});

/** Lists the workspace projects pnpm sees, without the repository root and the shared stack. */
async function readWorkspaceProjects(): Promise<WorkspaceProject[]> {
  const pnpmOutput = childProcess.execFileSync(
    "pnpm",
    ["ls", "--recursive", "--json", "--depth", "-1"],
    { cwd: REPOSITORY_ROOT, encoding: "utf8" },
  );
  const projects: WorkspaceProject[] = [];

  for (const { name, path: projectPath } of pnpmProjectListSchema.parse(JSON.parse(pnpmOutput))) {
    const directory = path.relative(REPOSITORY_ROOT, projectPath);
    if (directory === "" || directory.startsWith(".patricktree-stack/")) {
      continue;
    }

    const manifest = manifestSchema.parse(
      JSON.parse(await fs.readFile(path.join(projectPath, "package.json"), "utf8")),
    );
    projects.push({
      name,
      directory,
      exports: manifest.exports,
      subpathExportExceptions: manifest.cup?.subpathExportExceptions ?? {},
      readFile: (relativePath) => fs.readFile(path.join(projectPath, relativePath), "utf8"),
    });
  }
  return projects;
}

function createLibrary(
  overrides: Partial<WorkspaceProject> & { files?: Record<string, string> },
): WorkspaceProject {
  const { files = {}, ...project } = overrides;
  return {
    name: "@cup/example",
    directory: "libs/example",
    exports: undefined,
    subpathExportExceptions: {},
    readFile: async (relativePath) => {
      const content = files[relativePath];
      if (content === undefined) {
        throw new Error(`No fixture file ${relativePath}`);
      }
      return content;
    },
    ...project,
  };
}

test("every workspace package follows the package export rule", async () => {
  const projects = await readWorkspaceProjects();

  expect(projects.map((project) => project.name)).toContain("@cup/accounts");
  expect(await findPackageExportProblems(projects)).toEqual([]);
});

test("a production subpath export is reported", async () => {
  const project = createLibrary({
    exports: { "./schema": { types: "./dist/types/schema.d.ts", default: "./src/schema.ts" } },
  });

  expect(await findPackageExportProblems([project])).toEqual([
    "`@cup/example` exports production code `./src/schema.ts` at `./schema`; re-export it from `.`, or list `./schema` with its reason under `cup.subpathExportExceptions` in libs/example/package.json.",
  ]);
});

test("a production subpath export listed as an exception passes", async () => {
  const project = createLibrary({
    exports: { "./contracts": "./src/contracts.ts" },
    subpathExportExceptions: { "./contracts": "Loads without the Durable Object" },
  });

  expect(await findPackageExportProblems([project])).toEqual([]);
});

test("fakes and files outside src/ may be subpath exports", async () => {
  const project = createLibrary({
    exports: {
      "./package.json": "./package.json",
      "./fake": { types: "./dist/types/example.fake.d.ts", default: "./src/example.fake.ts" },
      "./vite": "./vite.shared.ts",
    },
  });

  expect(await findPackageExportProblems([project])).toEqual([]);
});

test("packages outside apps/ and libs/ may export any subpath", async () => {
  const project = createLibrary({
    directory: "tooling/example",
    exports: { "./schema-diagram": "./src/schema-diagram.ts" },
  });

  expect(await findPackageExportProblems([project])).toEqual([]);
});

test("an exception that no production subpath export needs is reported", async () => {
  const project = createLibrary({
    exports: { "./fake": "./src/example.fake.ts" },
    subpathExportExceptions: { "./fake": "Test double", "./removed": "No longer exported" },
  });

  expect(await findPackageExportProblems([project])).toEqual([
    "`@cup/example` lists `./fake` under `cup.subpathExportExceptions`, but it is not a production subpath export; remove the entry from libs/example/package.json.",
    "`@cup/example` lists `./removed` under `cup.subpathExportExceptions`, but it is not a production subpath export; remove the entry from libs/example/package.json.",
  ]);
});

test("a `.` export that re-exports other files must be src/index.ts", async () => {
  const project = createLibrary({
    exports: { ".": { types: "./dist/types/example.d.ts", default: "./src/example.ts" } },
    files: { "./src/example.ts": 'export { helper } from "#src/helper.ts";\n' },
  });

  expect(await findPackageExportProblems([project])).toEqual([
    "`@cup/example` re-exports other files from its `.` export `./src/example.ts`; move the re-exports into `./src/index.ts` and point `.` there.",
  ]);
});

test("a `.` export that defines its own code may live in any file", async () => {
  const project = createLibrary({
    exports: { ".": "./src/example.ts" },
    files: {
      "./src/example.ts": 'import { helper } from "#src/helper.ts";\nexport const x = 1;\n',
    },
  });

  expect(await findPackageExportProblems([project])).toEqual([]);
});
