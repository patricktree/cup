# API server

## Layout

`src/api-server.ts` is the package entry (the `.` export in `package.json`): `createApiServer` composes the listener and operator routes, middleware, and handlers with Hono from the folders below. `src/api-server-environment.ts` declares the Worker bindings and settings the server reads (`ApiServerEnvironment`) and imports nothing else from the package. The folders:

- `http/`: the HTTP concerns that `api-server.ts` mounts: account token verification and media cookies (`account-auth.ts`), ingress identity, development operator access, domain redirects, the web app CSP nonce (the `./web-app-csp` export), error responses, listener response mappings, and audio and cover image delivery. It may import `adapters/`, `use-cases/`, and the environment, never `src/api-server.ts`.
- `use-cases/`: the application rules, without Hono or bindings, that receive their Durable Object and storage calls as dependency arguments: account authentication, grant creation, conversion start, grant conversion and synthesis state, and ready audiobook loading. It imports neither `http/` nor `src/api-server.ts`.
- `adapters/`: calls to other bindings and services: conversion readers and conversion dispatch over the owning account or grant Durable Object, and Google token revocation through Supabase and Google. It may import the environment, never `http/`, `use-cases/`, or `src/api-server.ts`.

Tests stay flat in `test/`. [`oxlint.config.ts`](oxlint.config.ts) enforces these import directions with `no-restricted-imports`; place a new file in the folder of its role, and extend the overrides there when you add a folder.
