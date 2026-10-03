# Cup documentation

Start with the [domain context](CONTEXT.md) for Cup's vocabulary and the [system overview](architecture/README.md) for the components and their relationships. These pages describe the current checkout; they do not establish what is deployed in production.

## Understand the system

| Page                                                               | What it explains                                                                                         |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| [Domain context](CONTEXT.md)                                       | Canonical concepts, terminology, and rejected synonyms                                                   |
| [System overview](architecture/README.md)                          | Runtime components, API definitions, storage ownership, external services, and development boundaries    |
| [Authentication and authorization](architecture/authentication.md) | Google and Supabase sign-in, Cup account provisioning, media access, trials, and operator authentication |
| [Durable Object schemas](architecture/durable-object-storage.md)   | SQLite tables, columns, keys, and relationships for all three Durable Object stores                      |
| [Conversion](architecture/conversion.md)                           | Source preparation through delivery, duration accounting, retries, and failure boundaries                |
| [Account deletion](architecture/account-deletion.md)               | Fresh authentication, recovery, write fencing, cleanup, and notification retries                         |

## Operate and develop Cup

| Guide                                                                | Purpose                                                                                |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [Repository setup and validation](../AGENTS.md)                      | Prepare a checkout and run checks                                                      |
| [Social signup operations](social-signup-operations.md)              | Configure local authentication, supply production configuration, and inspect accounts  |
| [Mobile development](../apps/mobile-app/README.md)                   | Build native shells and configure platform links and sharing                           |
| [Account migrations](../libs/accounts/README.md#database-migrations) | Change account Drizzle schemas and validate account storage                            |
| [Grant migrations](../libs/conversion-grants/README.md)              | Change trial Drizzle schemas and validate grant storage                                |
| [Registry migrations](../libs/registry/README.md)                    | Change the shared registry schema and preserve deployed registry storage               |
| [Conversion contracts](../libs/conversion-contracts/README.md)       | Shared conversion types, schemas, and duration calculations                            |
| [Operator CLI](../apps/operator/README.md)                           | Manage trial grants and inspect account lifecycle operations                           |
| [Terraform infrastructure](../terraform/README.md)                   | Manage infrastructure state, provider configuration, and manual prerequisites          |
| [Declaration builds](declaration-builds.md)                          | Understand source and declaration package scopes, compiler settings, and build caching |
| [Brand assets](../tooling/brand-assets/README.md)                    | Maintain generated application branding                                                |

## Decisions and evidence

[ADRs](adr/README.md) preserve accepted decisions and their rationale. Acceptance does not imply every consequence is implemented. Architecture pages identify material implementation gaps and link to the relevant decisions.

[Research](research/README.md) preserves investigations, sources, and experiment artifacts. Its recommendations reflect the investigation's context and may have been superseded.

## Maintain this documentation

Use [local documentation search](../tooling/docs-search/README.md) to discover related explanations as well as locate pages. Follow the [required search procedure for concept and behavior changes](agents/domain.md#find-supporting-documentation), including removals where the exact phrase is already known. Search supports keyword and semantic retrieval with a separate index for each checkout. Read the current source files before relying on results.

For Cloudflare runtime, configuration, and design decisions, follow the [Cloudflare documentation guidance](agents/cloudflare.md), including product references and the AI Gateway binding requirement.

Before design or implementation, read the domain context and relevant architecture pages and ADRs. Update affected explanations, diagrams, and source links in the same change as the implementation. Follow the [documentation maintenance instructions](agents/domain.md).

Keep implementation detail in code: link to route contracts, schemas, and configuration instead of copying their contents. Document responsibilities, relationships, guarantees, and behavior that requires reading across components. Extend existing pages before adding another explanation of the same subject.

Run `pnpm docs:check` for Markdown and local-link validation; it also runs in `pnpm validate:fast`. These checks detect structural problems, not architectural correctness. Review diagrams and explanations against the linked implementation when changing behavior.

Label unverified configuration and future plans explicitly. Use Git history for the chronology of documentation changes.
