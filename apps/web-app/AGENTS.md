# Web App Agent Instructions

## Scope

- Applies to `apps/web-app/**`.
- Follow the root `AGENTS.md` for package manager, validation, testing, and commits.

## Layout

- `src/app/**`: React UI and styling.
- `src/app/design-system/**`: reusable UI primitives.

## Local Conventions

- Use package imports such as `#src/...`.
- Prefer `DSButton` over raw buttons for app UI.
- Define all `useMutation` hooks in `src/data-fetching/*` files and import those hooks into components and routes.
- Use `useAppForm` for forms; follow `src/app/components/start-conversion-form.tsx`.
- Use `WebAppApiClient` from `@cup/web-app-api.client` for API calls, including its authenticated RPC client for account requests; follow `libs/web-app-api.client/src/rpc-client.ts` from the repo root.

## Commands

- During development: `pnpm validate:fast` from the repo root. Before pushing to `main` (shipping to production): `pnpm validate`.
- Run locally through its host: `pnpm --filter '@cup/cloudflare-worker' dev`.
