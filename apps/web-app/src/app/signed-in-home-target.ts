import { hasPendingSharedUrl } from "#src/platform/share-intake.js";

/**
 * Where the home page sends a signed-in listener: Recents, or the Add dialog while a shared URL
 * waits for a form to take it, because share intake sends a signed-in listener there too.
 */
export function signedInHomeTarget(): "/recent" | "/recent/add" {
  return hasPendingSharedUrl() ? "/recent/add" : "/recent";
}
