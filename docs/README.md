# Cup documentation

Start with the [glossary](GLOSSARY.md) for Cup's vocabulary and the [system overview](architecture/README.md) for the components and their relationships. These pages describe the current checkout; they do not establish what is deployed in production.

## Understand the system

| Page                                                               | What it explains                                                                                         |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| [Glossary](GLOSSARY.md)                                            | Canonical concepts, terminology, and rejected synonyms                                                   |
| [System overview](architecture/README.md)                          | Runtime components, API definitions, storage ownership, external services, and development boundaries    |
| [Authentication and authorization](architecture/authentication.md) | Google and Supabase sign-in, Cup account provisioning, media access, trials, and operator authentication |
| [Durable Object schemas](architecture/durable-object-storage.md)   | SQLite tables, relationships, and naming conventions for all three Durable Object stores                 |
| [R2 objects and key layout](architecture/r2-storage.md)            | Account and trial prefixes, stored objects, metadata, access, and cleanup                                |
| [Conversion](architecture/conversion.md)                           | Source preparation through delivery, duration accounting, retries, and failure boundaries                |
| [Account deletion](architecture/account-deletion.md)               | Fresh authentication, recovery, write fencing, cleanup, and notification retries                         |

## Operate and develop Cup

| Guide                                                                                 | Purpose                                                                                |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [Repository setup and validation](../AGENTS.md)                                       | Prepare a checkout and run checks                                                      |
| [Local development](local-development.md)                                             | Run the web application against local services                                         |
| [Web application](../apps/web-app/README.md)                                          | Develop, build, and manually verify the shared UI; run component tests                 |
| [Worker development and integration tests](../apps/cloudflare-worker/AGENTS.md)       | Run the Worker locally and test it without external services                           |
| [Application E2E tests](../qa/e2e/README.md)                                          | Run the complete local conversion path and update screenshots                          |
| [Recorded source pages](../libs/prepare-source-material/test-e2e/fixtures/README.md)  | Replay source-page fixtures in source-material E2E tests                               |
| [Narration selection evals](../libs/narration-content-selection/test/evals/README.md) | Run the paid narration content selection evals                                         |
| [Production configuration](production-configuration.md)                               | Supply Worker secrets and provider settings                                            |
| [Mobile development](../apps/mobile-app/README.md)                                    | Build native shells and configure platform links and sharing                           |
| [Account migrations](../libs/accounts/README.md#database-migrations)                  | Change account Drizzle schemas and validate account storage                            |
| [Grant migrations](../libs/conversion-grants/README.md)                               | Change trial Drizzle schemas and validate grant storage                                |
| [Registry migrations](../libs/registry/README.md)                                     | Change the shared registry schema and preserve deployed registry storage               |
| [Conversion contracts](../libs/conversion-contracts/README.md)                        | Shared conversion types, schemas, and duration calculations                            |
| [Listener API contracts](../libs/listener-api.routes/README.md)                       | Change listener routes and error codes, and update the OpenAPI snapshot                |
| [Operator API contracts](../libs/operator-api.routes/README.md)                       | Change operator routes and error codes, and update the OpenAPI snapshot                |
| [Duration ledger](../libs/duration-ledger/README.md)                                  | Shared allowance, reservation, and charge storage for accounts and grants              |
| [Operator CLI](../apps/operator/README.md)                                            | Manage conversion grants, list accounts and account deletions, and adjust allowances   |
| [Terraform infrastructure](../terraform/README.md)                                    | Manage infrastructure state, provider configuration, and manual prerequisites          |
| [Declaration builds](declaration-builds.md)                                           | Understand source and declaration package scopes, compiler settings, and build caching |
| [Brand assets](../tooling/brand-assets/README.md)                                     | Maintain generated application branding                                                |
| [Library layers](../tooling/library-layers/README.md)                                 | Enforce the dependency directions between libraries with Turborepo Boundaries          |
| [Migration generator](../tooling/drizzle-migrations/README.md)                        | Generate SQLite migrations, snapshots, and Worker bundles; check schema diagrams       |
| [Submodule check](../.patricktree-stack/tooling/submodule-check/README.md)            | Reject commits that move a submodule pointer backwards                                 |
| [Mermaid check](../.patricktree-stack/tooling/mermaid-check/README.md)                | Parse Mermaid diagrams in documentation                                                |

## Decisions and evidence

[ADRs](adr/README.md) and [research](research/README.md) are dated history: ADRs record accepted decisions and why they were made, research keeps investigations with their sources and observation dates. An accepted decision may not be fully built, and a research recommendation may have been superseded; architecture pages identify material implementation gaps and link to the relevant decisions.

## Maintain this documentation

Agents maintain these pages by the [wiki schema](agents/domain.md).

| Page                                                           | Purpose                                                                                   |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [Wiki schema](agents/domain.md)                                | Layers, size budget, documentation search, decisions and evidence, landing, health review |
| [Local documentation search](../tooling/docs-search/README.md) | Keyword and semantic search over this checkout's documentation                            |
| [Issue tracker](agents/issue-tracker.md)                       | GitHub Issues conventions and wayfinder maps                                              |
| [Triage labels](agents/triage-labels.md)                       | Label strings for the canonical triage roles                                              |
| [Cloudflare documentation guidance](agents/cloudflare.md)      | Product references and the AI Gateway binding requirement                                 |

Run `pnpm docs:check` for Markdown, local-link, and [Mermaid diagram](../.patricktree-stack/tooling/mermaid-check/README.md) validation.
