import { ListenerApiClient } from "@cup/listener-api.client";

import { apiOrigin } from "#src/platform/api-origin.js";

export function createListenerApiClient(): ListenerApiClient {
  return new ListenerApiClient(apiOrigin());
}
