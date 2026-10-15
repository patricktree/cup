import { ListenerApiClient } from "@cup/listener-api.client";

import { apiOrigin } from "#src/platform/api-origin.js";

export function createAppApiClient(): ListenerApiClient {
  return new ListenerApiClient(apiOrigin());
}
