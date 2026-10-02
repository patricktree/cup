// https://hono.dev/docs/guides/rpc#compile-your-code-before-using-it-recommended
import { hc } from "hono/client";

import type { createWebAppContractApp } from "#src/hono-app.ts";

/** Typed Hono application returned by the create-audiobook-from-url API factory. */
export type WebAppApiApp = ReturnType<typeof createWebAppContractApp>;

/** Hono RPC client inferred from the create-audiobook-from-url API application. */
export type WebAppApiClient = ReturnType<typeof hc<WebAppApiApp>>;
