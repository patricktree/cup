# pnpm workspace project listing

Research date: 2026-10-27. Repository observations are from commit `36b1680` (branch `claude/monorepo-exports-audit-92f37d`). pnpm source claims cite the `pnpm/pnpm` tag `v12.15.0` (commit [`91774e7`](https://github.com/pnpm/pnpm/tree/91774e72a04d52ce61db06339696a433d383c764)) unless stated otherwise; registry facts are from crates.io and the npm registry on that date.

## Question

The [package export rule enforcement](package-export-rule-enforcement.md) research recommends a Vitest test that lists every workspace package and checks its `package.json` `exports`. Could that test use the Rust crates of pnpm 12 to list the workspace projects and read their manifests, and if not, what should it use?

## pnpm 12 is the Rust CLI

pnpm 12 is released and written in Rust. The [`pnpm 12` release](https://github.com/pnpm/pnpm/releases/tag/v12.0.0) was published on 2026-08-26. On the research date, npm's `latest` tag points to `12.15.0` and `next-12` to `12.16.0`, which was tagged on GitHub the same morning. The [`pnpm/pnpm` AGENTS.md](https://github.com/pnpm/pnpm/blob/91774e72a04d52ce61db06339696a433d383c764/AGENTS.md) says the repository holds the TypeScript pnpm 11 CLI in `pnpm11/`, the Rust pnpm 12 CLI ("pacquet") in `pnpm/` and the `pnpr` registry server in `pnpr/`, and that pnpm 12 is the target for new development while pnpm 11 gets bug fixes. The former [`pnpm/pacquet`](https://github.com/pnpm/pacquet) repository is archived. The repository README at the same tag still calls the Rust port "experimental", which contradicts AGENTS.md and the release; I treat the README line as stale.

Cup pins `pnpm@12.11.2` in `packageManager` and `engines.pnpm` of the root `package.json`, and `pnpm --version` in the checkout prints `12.11.2`. Corepack's copy of that package (`~/.cache/node/corepack/v1/pnpm/12.11.2`) contains a 41 MB Mach-O `pnpm-native` executable next to small JavaScript launchers, and its `package.json` lists `rust` as a keyword and `@pnpm/exe.<platform>` binaries as optional dependencies.

## The crates are workspace-internal

**No pnpm crate is on crates.io.** The root [`Cargo.toml`](https://github.com/pnpm/pnpm/blob/91774e72a04d52ce61db06339696a433d383c764/Cargo.toml) has about 100 path-only `pnpm-*` members under `pnpm/crates/*`. The two relevant ones set `publish = false`: [`pnpm-workspace`](https://github.com/pnpm/pnpm/blob/91774e72a04d52ce61db06339696a433d383c764/pnpm/crates/workspace/Cargo.toml) and [`pnpm-package-manifest`](https://github.com/pnpm/pnpm/blob/91774e72a04d52ce61db06339696a433d383c764/pnpm/crates/package-manifest/Cargo.toml), both at version `0.0.1`; the same holds at `v12.11.2` (commit `1e37c51`). crates.io answers "does not exist" for `pnpm-workspace`, `pnpm-package-manifest` and `pnpm-napi`. The names `pnpm` and `pacquet` there are `0.0.0` placeholders; the `pacquet` one says the Rust port lives in the pnpm monorepo.

**`pnpm-workspace` is the crate that lists projects.** Its [`lib.rs`](https://github.com/pnpm/pnpm/blob/91774e72a04d52ce61db06339696a433d383c764/pnpm/crates/workspace/src/lib.rs) exports `find_workspace_dir`, `read_workspace_manifest`, `workspace_package_patterns` and `find_workspace_projects`. In [`projects.rs`](https://github.com/pnpm/pnpm/blob/91774e72a04d52ce61db06339696a433d383c764/pnpm/crates/workspace/src/projects.rs), `find_workspace_projects(workspace_root, opts)` glob-expands the `packages:` patterns and returns `Vec<Project>`, each with `root_dir: PathBuf` and `manifest: PackageManifest`.

**`exports` is reachable only as raw JSON.** [`PackageManifest`](https://github.com/pnpm/pnpm/blob/91774e72a04d52ce61db06339696a433d383c764/pnpm/crates/package-manifest/src/lib.rs) stores the file as a private `serde_json::Value` ("TODO: convert this into a proper struct") and exposes it through `value()`. So a Rust caller reads `project.manifest.value()["exports"]` with no type.

## Calling them from a Vitest test

**No published binding lists workspace projects.** pnpm ships Node-API bindings as [`@pnpm/napi`](https://github.com/pnpm/pnpm/tree/91774e72a04d52ce61db06339696a433d383c764/pnpm/npm/napi) (npm versions `12.0.0-alpha.3` to `12.16.0`, published under the `next-12` tag with per-platform `@pnpm/napi.<platform>` packages; `latest` is a `0.0.0-0` placeholder). Its README and `index.d.ts` expose `install`, `rebuild`, `resolveDependency`, `pack`, `parseBareSpecifier`, `readConfig`, `getDependents`, `renderDependents`, lockfile and `.modules.yaml` readers and writers, `engineVersion` and `getPeerDependencyIssues`. None enumerates workspace projects: `install` takes the projects and their manifests as input. I found no WebAssembly build.

**Using the crates directly means building Rust.** A Cup tool would depend on `pnpm-workspace` by Git URL and tag, and with it on the pnpm workspace's pinned toolchain ([`rust-toolchain.toml`](https://github.com/pnpm/pnpm/blob/91774e72a04d52ce61db06339696a433d383c764/rust-toolchain.toml): Rust `1.97.0`), on Rust in CI and every development machine, and on a Turborepo task that compiles a binary or napi addon before the test runs. The crate's API is internal and unversioned (`0.0.1`, unpublished), so any pnpm commit may change it. pnpm 12.11 can install a toolchain from `rust-toolchain.toml` (`cargo.enabled`, per the 12.11.0 changelog in the installed package), which lowers the setup cost but not the build or the API instability.

**The CLI already exposes the crate's result.** The [`pnpm list` page for v12](https://github.com/pnpm/pnpm/blob/91774e72a04d52ce61db06339696a433d383c764/pnpm/docs/cli/list.md) says `pnpm ls --depth -1` lists projects only, for use with `-r`, and `--json` prints JSON. In the Rust CLI, `pnpm ls -r` reaches [`discover_workspace_projects`](https://github.com/pnpm/pnpm/blob/91774e72a04d52ce61db06339696a433d383c764/pnpm/crates/cli/src/cli_args/recursive.rs), which reads `pnpm-workspace.yaml` and calls `pnpm_workspace::find_workspace_projects`. In Cup, `pnpm ls -r --json --depth -1` (pnpm 12.11.2) ran in under 0.1 s and printed 44 entries of `{ name, path, private }` (plus `version` where set): the root and the 12 `.patricktree-stack` projects among them. The manifest itself is then one `readFileSync` away.

## JavaScript alternatives

- **`@pnpm/workspace.find-packages`** last published `1000.0.65` on 2026-03-24; it is not deprecated. Its maintained successor appears to be [`@pnpm/workspace.projects-reader`](https://github.com/pnpm/pnpm/tree/91774e72a04d52ce61db06339696a433d383c764/pnpm11/workspace/projects-reader) (same description, first release 2026-03-19, latest `1101.1.6` on 2026-10-27), but it lives in the maintenance-only `pnpm11/` tree. `findWorkspaceProjects(root, { patterns })` returns `{ rootDir, manifest }`; the caller still reads `pnpm-workspace.yaml` for the patterns, and it needs the `@pnpm/logger` peer. `@pnpm/types` types `exports` as `Record<string, string>` ([`package.ts`](https://github.com/pnpm/pnpm/blob/91774e72a04d52ce61db06339696a433d383c764/pnpm11/core/types/src/package.ts)), which does not fit Cup's `{ types, default }` conditions.
- **`@pnpm/find-workspace-packages`** last published `6.0.9` in 2023; it is the pre-rename name.
- **[`@manypkg/get-packages`](https://github.com/Thinkmill/manypkg/tree/main/packages/get-packages)** `3.1.0` (2025-07-25) returns `{ dir, relativeDir, packageJson }` per package, but its `PackageJSON` type covers name, version and dependency fields only.
- **YAML plus glob**, as the earlier page sketched: Node's `fs.glob` is stable since v24.0.0 ([Node `fs` docs](https://github.com/nodejs/node/blob/v24.18.0/doc/api/fs.md)) and Cup requires Node `^24.21.0`, but no Cup package depends directly on a YAML parser (`yaml` and `js-yaml` are only transitive in `pnpm-lock.yaml`), and the test would reimplement pnpm's pattern semantics.

The removed library-layers test (commit `56b30a7`) did not list workspace packages: it read `fs.readdir("libs")` and parsed each `turbo.jsonc` with `jsonc-parser` and `zod`. The `.patricktree-stack` submodule (commit `6764f8d`) has a `pkg-management` tool that uses `@pnpm/workspace.find-packages` with `js-yaml`, but Cup's `pnpm-workspace.yaml` does not include that project.

## Recommendation

Do not use the Rust crates: they are unpublished, unversioned internals, and reaching them from Vitest needs a Rust build in CI and development for one list of directories. Ask the pnpm 12 CLI instead. `pnpm ls -r --json --depth -1` runs the same `find_workspace_projects` code, so the test sees exactly the projects pnpm sees, with no new dependency. Read each `package.json` with `JSON.parse` and validate `exports` with the `zod` schema the test needs anyway.

```ts
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPOSITORY_ROOT = path.join(import.meta.dirname, "../../..");

type WorkspaceProject = { name: string; path: string; manifest: { exports?: unknown } };

function listWorkspaceProjects(): WorkspaceProject[] {
  const output = execFileSync("pnpm", ["ls", "--recursive", "--json", "--depth", "-1"], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  });
  return (JSON.parse(output) as { name: string; path: string }[])
    .filter(
      (project) => !path.relative(REPOSITORY_ROOT, project.path).startsWith(".patricktree-stack"),
    )
    .map((project) => ({
      ...project,
      manifest: JSON.parse(fs.readFileSync(path.join(project.path, "package.json"), "utf8")),
    }));
}
```

A scratch run of this logic found 32 Cup projects, of which 29 declare `exports`; the three without are `@cup/monorepo-root`, `@cup/mobile-app` and `@cup/e2e`. If spawning `pnpm` from a test is unwanted, the fallback is `yaml` plus `fs.glob` over the `packages` patterns, which is equally short but duplicates pnpm's pattern rules.

## Limits

- The `pnpm ls --json` field set is documented only as "JSON format"; I inferred `{ name, path, private, version }` from one local run of 12.11.2, not from a schema.
- That `@pnpm/workspace.projects-reader` succeeds `@pnpm/workspace.find-packages` is inferred from their descriptions, source location and release dates; I found no deprecation notice or changelog entry stating it.
- I did not build `pnpm-workspace` from Git or try `@pnpm/napi`; the toolchain cost is estimated from the crate manifests and `rust-toolchain.toml`.
- The test assumes `pnpm` is on `PATH` when Vitest runs, which holds for `pnpm validate:fast` and Turborepo tasks; I did not check a bare `vitest` run outside pnpm.
