/** A `package.json` `exports` field; a conditional target always has a `default` condition here. */
type ExportsField =
  | string
  | Record<string, string | { [condition: string]: string; default: string }>;

export type WorkspaceProject = {
  name: string;
  /** Path relative to the repository root, such as `libs/accounts`. */
  directory: string;
  exports: ExportsField | undefined;
  /** `cup.subpathExportExceptions` of the project's `package.json`: subpath to reason. */
  subpathExportExceptions: Record<string, string>;
  /** Reads a file by its path relative to the project directory. */
  readFile: (relativePath: string) => Promise<string>;
};

/** Only these directories hold production code; `tooling/` and `qa/` packages hold none. */
const PRODUCTION_DIRECTORIES = ["apps/", "libs/"];
const ROOT_INDEX = "./src/index.ts";
/** `export { … } from "…"` or `export * from "…"` of a file inside the package. */
const LOCAL_RE_EXPORT = /^export\s[^;]*?\sfrom\s+["'](?:#src\/|\.{1,2}\/)/m;

/**
 * Checks the package export rule of the system overview: production code is exported through `.`,
 * which is `src/index.ts` when it re-exports other files. In `apps/` and `libs/`, a subpath export
 * pointing into `src/` is production code unless it is a `*.fake.ts` test double; such a subpath
 * passes only when `cup.subpathExportExceptions` lists it with a reason.
 */
export async function findPackageExportProblems(projects: WorkspaceProject[]): Promise<string[]> {
  const problems: string[] = [];

  for (const project of projects) {
    const targets = readExportTargets(project);
    const manifestPath = `${project.directory}/package.json`;
    const isProductionPackage = PRODUCTION_DIRECTORIES.some((directory) =>
      project.directory.startsWith(directory),
    );

    const productionSubpaths = new Set<string>();
    for (const [subpath, target] of targets) {
      if (subpath === "." || !isProductionPackage || !isProductionTarget(target)) {
        continue;
      }

      productionSubpaths.add(subpath);
      if (project.subpathExportExceptions[subpath] === undefined) {
        problems.push(
          `\`${project.name}\` exports production code \`${target}\` at \`${subpath}\`; re-export it from \`.\`, or list \`${subpath}\` with its reason under \`cup.subpathExportExceptions\` in ${manifestPath}.`,
        );
      }
    }

    for (const subpath of Object.keys(project.subpathExportExceptions)) {
      if (!productionSubpaths.has(subpath)) {
        problems.push(
          `\`${project.name}\` lists \`${subpath}\` under \`cup.subpathExportExceptions\`, but it is not a production subpath export; remove the entry from ${manifestPath}.`,
        );
      }
    }

    const rootTarget = targets.get(".");
    if (
      rootTarget !== undefined &&
      rootTarget !== ROOT_INDEX &&
      LOCAL_RE_EXPORT.test(await project.readFile(rootTarget))
    ) {
      problems.push(
        `\`${project.name}\` re-exports other files from its \`.\` export \`${rootTarget}\`; move the re-exports into \`${ROOT_INDEX}\` and point \`.\` there.`,
      );
    }
  }
  return problems;
}

function isProductionTarget(target: string): boolean {
  return target.startsWith("./src/") && !target.endsWith(".fake.ts");
}

/** Maps each subpath to the file it loads at runtime: the target string or its `default` condition. */
function readExportTargets(project: WorkspaceProject): Map<string, string> {
  const targets = new Map<string, string>();
  if (project.exports === undefined) {
    return targets;
  }

  const entries =
    typeof project.exports === "string"
      ? [[".", project.exports] as const]
      : Object.entries(project.exports);
  for (const [subpath, value] of entries) {
    targets.set(subpath, typeof value === "string" ? value : value.default);
  }
  return targets;
}
