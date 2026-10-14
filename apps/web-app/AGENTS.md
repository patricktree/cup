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
- Send API calls through `requestApi` in `src/data-fetching/api-request.ts`: choose `"none"`, `"optional"`, or `{ subject }` account authorization and call a `WebAppApiClient` or `AuthenticatedRpcClient` method from `@cup/web-app-api.client` (see `libs/web-app-api.client/src/rpc-client.ts` from the repo root). Handle failed responses as `RpcError`, matching on `status` and `code`.

## Commands

- During development: `pnpm validate:fast` from the repo root. Before pushing to `main` (shipping to production): `pnpm validate`.
- Run locally through its host: `pnpm --filter '@cup/cloudflare-worker' dev`.
