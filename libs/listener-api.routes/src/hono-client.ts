// https://hono.dev/docs/guides/rpc#compile-your-code-before-using-it-recommended
import { hc } from "hono/client";

import type { createListenerContractApp } from "#src/hono-app.ts";

/** Typed Hono application returned by the create-audiobook-from-url API factory. */
export type ListenerApiApp = ReturnType<typeof createListenerContractApp>;

/** Hono RPC client inferred from the create-audiobook-from-url API application. */
export type ListenerApiClient = ReturnType<typeof hc<ListenerApiApp>>;
