# API server

## Layout

`src/index.ts` is the package entry (the `.` export in `package.json`); `createApiServer` in `src/api-server.ts` composes the listener and operator routes, middleware, and handlers with Hono from the folders below. `src/api-server-environment.ts` declares the Worker bindings and settings the server reads (`ApiServerEnvironment`) and imports nothing else from the package. The folders:

- `http/`: the HTTP concerns that `api-server.ts` uses, such as token verification, signed media URLs, error responses, and delivery. It may import `adapters/`, `use-cases/`, and the environment, never `src/index.ts` or `src/api-server.ts`.
- `use-cases/`: the application rules, without Hono or bindings, that receive their Durable Object and storage calls as dependency arguments. It imports neither `http/` nor `src/index.ts` or `src/api-server.ts`.
- `adapters/`: calls to other bindings and services: conversion readers and conversion dispatch over the owning account or grant Durable Object, and Google token revocation through Supabase and Google. It may import the environment, never `http/`, `use-cases/`, `src/index.ts`, or `src/api-server.ts`.

Tests stay flat in `test/`. [`oxlint.config.ts`](oxlint.config.ts) enforces these import directions with `no-restricted-imports`; place a new file in the folder of its role, and extend the overrides there when you add a folder.
