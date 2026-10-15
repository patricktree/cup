import { hc } from "hono/client";

import { trimTrailingSlash } from "@cup/api-rpc.client";
import type { WebAppApiApp, WebAppApiClient } from "@cup/web-app-api.routes";

// This indirection preserves inferred routes and works around TypeScript issue 47663.
const hcWithType = (...args: Parameters<typeof hc>): WebAppApiClient => hc<WebAppApiApp>(...args);

/** Typed Hono client inferred from the create-audiobook-from-url API routes. */
export type HonoClient = ReturnType<typeof hcWithType>;

/** Creates a typed Hono client for the supplied API base URL. */
export function createHonoClient(baseUrl: string): HonoClient {
  return hcWithType(trimTrailingSlash(baseUrl), {});
}
