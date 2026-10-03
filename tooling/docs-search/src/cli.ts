import { Command, CommanderError, Option } from "@commander-js/extra-typings";
import childProcess from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const QMD_DIRECTORY = path.join(ROOT, ".qmd");
const LOCK_DIRECTORY = path.join(QMD_DIRECTORY, "run.lock");
// QMD requires a TypeScript 5 peer; isolate it from Cup's TypeScript 6 toolchain.
const QMD_COMMAND = [
  "--reporter",
  "silent",
  "--package",
  "@tobilu/qmd@2.8.3",
  "--package",
  "typescript@5.9.3",
  "dlx",
  "--allow-build",
  "better-sqlite3",
  "--allow-build",
  "node-llama-cpp",
  "--allow-build",
  "tree-sitter-go",
  "--allow-build",
  "tree-sitter-javascript",
  "--allow-build",
  "tree-sitter-python",
  "--allow-build",
  "tree-sitter-rust",
  "--allow-build",
  "tree-sitter-typescript",
  "qmd",
];
const searchResultsSchema = z.array(z.object({ file: z.string() }));
const retrievalChecksSchema = z.array(
  z.object({
    id: z.string(),
    mode: z.enum(["search", "query"]),
    query: z.string(),
    expectedFile: z.string(),
  }),
);

const program = new Command()
  .name("docs:search")
  .description("Search Cup documentation using this checkout's QMD index")
  .showHelpAfterError()
  .exitOverride();

program
  .command("refresh")
  .description("Refresh this checkout's index and embeddings")
  .option("--lexical", "update only the keyword index, without loading models")
  .action(async (options) => withIndexLock(() => refresh(!options.lexical)));

for (const mode of ["search", "vsearch", "query"] as const) {
  program
    .command(mode)
    .description(
      {
        search: "Refresh and search by keywords (BM25; no models)",
        vsearch: "Refresh and search by semantic similarity",
        query: "Refresh and search with hybrid retrieval and reranking",
      }[mode],
    )
    .argument("<question>", "question or search terms")
    .option("--json", "return machine-readable results on stdout")
    .addOption(
      new Option("-c, --collection <name>")
        .choices(["cup-docs", "cup-guides", "cup-decisions", "cup-research"])
        .default("cup-docs"),
    )
    .action(async (question, options) =>
      withIndexLock(async () => {
        await refresh(mode !== "search");
        const args = [mode, question, "-n", "5"];
        if (options.json) args.push("--json");
        if (options.collection) args.push("-c", options.collection);
        process.stdout.write(await runQmd(args));
      }),
    );
}

program
  .command("status")
  .description("Show QMD status for this checkout without refreshing")
  .action(async () =>
    withIndexLock(async () => {
      process.stdout.write(await runQmd(["status"]));
    }),
  );

program
  .command("check")
  .description("Refresh and check Cup's retrieval questions (includes local model inference)")
  .option("--lexical", "run only the keyword checks, without loading models")
  .action(async (options) =>
    withIndexLock(async () => {
      await refresh(!options.lexical);
      await checkRetrieval(options.lexical ?? false);
    }),
  );

try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof CommanderError) process.exitCode = error.exitCode;
  else {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

async function withIndexLock(operation: () => Promise<void>) {
  await fs.access(path.join(QMD_DIRECTORY, "index.yml"));
  if ((await fs.readdir(QMD_DIRECTORY)).includes("index.yaml")) {
    throw new Error("Remove the competing .qmd/index.yaml configuration; Cup uses .qmd/index.yml.");
  }
  console.error(`Cup search checkout: ${ROOT}`);
  try {
    await fs.mkdir(LOCK_DIRECTORY);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(
        `Another search holds ${LOCK_DIRECTORY}. If a previous run was interrupted, confirm it has stopped before removing that directory.`,
        { cause: error },
      );
    }
    throw error;
  }
  try {
    await operation();
  } finally {
    await fs.rmdir(LOCK_DIRECTORY);
  }
}

async function refresh(semantic: boolean) {
  await runQmd(["update"], true);
  if (semantic) await runQmd(["embed"], true);
}

async function runQmd(args: string[], progress = false): Promise<string> {
  // Disambiguate conversion and allowance from unrelated financial terminology.
  if (args[0] === "query") {
    args = [
      ...args,
      "--intent",
      "Cup converts source URLs into audiobooks. Allowance measures generated audio duration. Questions concern this software system.",
    ];
  }
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn("pnpm", [...QMD_COMMAND, ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        QMD_CONFIG_DIR: QMD_DIRECTORY,
        INDEX_PATH: path.join(QMD_DIRECTORY, "index.sqlite"),
      },
      stdio: ["ignore", "pipe", "inherit"],
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (progress) process.stderr.write(chunk);
      else output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) resolve(output);
      else reject(new Error(`QMD ${args[0]} failed (${signal ?? code}).`));
    });
  });
}

async function checkRetrieval(lexicalOnly: boolean) {
  const checks = retrievalChecksSchema.parse(
    JSON.parse(await fs.readFile(new URL("../retrieval-checks.json", import.meta.url), "utf8")),
  );
  let failures = 0;
  for (const check of checks.filter((item) => !lexicalOnly || item.mode === "search")) {
    const results = searchResultsSchema.parse(
      JSON.parse(await runQmd([check.mode, check.query, "-c", "cup-docs", "-n", "3", "--json"])),
    );
    const rank = results.findIndex((result) => result.file === check.expectedFile) + 1;
    console.log(
      `${rank ? "PASS" : "FAIL"} ${check.id}: ${check.expectedFile} (rank ${rank || "absent"})`,
    );
    if (!rank) failures += 1;
  }
  if (failures)
    throw new Error(`${failures} retrieval checks missed the expected page in the top 3.`);
}
