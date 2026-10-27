# Web App Agent Instructions

## Scope

- Applies to `apps/web-app/**`.
- Follow the root `AGENTS.md` for package manager, validation, testing, and commits.

## Layout

- `src/app/**`: React UI and styling.
- `src/app/design-system/**`: reusable UI primitives.

## Local Conventions

- Use package imports such as `#src/...`.
- Prefer `DSButton` over raw buttons for app UI, and `DSIconButton` with an icon from `src/app/design-system/icons.tsx` for icon-only controls.
- Redesigned screens use the text styles in `src/app/design-system/text-styles.ts` and spread `interTypefaceScope` from `src/app/global-styles.ts` on their root, so the global Space Mono rule for `span` and `input` stays out of them; the design-system story shows the tokens, text styles, icons and components.
- Define all `useMutation` hooks in `src/data-fetching/*` files and import those hooks into components and routes.
- Use `useAppForm` for forms; follow `src/app/components/source-url-form.tsx`.
- Send API calls through `requestApi` in `src/data-fetching/api-request.ts`: choose `"none"`, `"optional"`, or `{ subject }` account authorization and call a `ListenerApiClient` or `AuthenticatedRpcClient` method from `@cup/listener-api.client` (see `libs/listener-api.client/src/rpc-client.ts` from the repo root). Handle failed responses as `RpcError`, matching on `status` or on `code` compared with `ERROR_CODE`, never with a string literal. Lint enforces both: `fetch` is a restricted global, and only `api-request.ts` and the session machine plumbing in `src/auth/account-session.ts` may import `#src/api-client.js` ([`oxlint.config.ts`](oxlint.config.ts)).

## Commands

- During development: `pnpm validate:fast` from the repo root. Before pushing to `main` (shipping to production): `pnpm validate`.
- Run locally through its host: `pnpm --filter '@cup/cloudflare-worker' dev`.
