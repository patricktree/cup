import { WebAppApiClient } from "@cup/web-app-api.client";

import { apiOrigin } from "#src/platform/api-origin.js";

export function createAppApiClient(): WebAppApiClient {
  return new WebAppApiClient(apiOrigin());
}
