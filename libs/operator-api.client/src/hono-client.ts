import { hc } from "hono/client";

import { trimTrailingSlash } from "@cup/api-rpc.client";
import type { OperatorApiApp, OperatorApiClient } from "@cup/operator-api.routes";

// This indirection preserves inferred routes and works around TypeScript issue 47663.
const hcWithType = (...args: Parameters<typeof hc>): OperatorApiClient =>
  hc<OperatorApiApp>(...args);

/** Typed Hono client inferred from the operator API routes. */
export type HonoClient = ReturnType<typeof hcWithType>;

/** Creates a typed Hono client for the supplied operator API base URL. */
export function createHonoClient(baseUrl: string): HonoClient {
  return hcWithType(trimTrailingSlash(baseUrl), {});
}
