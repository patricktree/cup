import { registerPlugin } from "@capacitor/core";
import type { SupabaseClient } from "@supabase/supabase-js";

import { initializeAuthStorage as initializeSecureAuthStorage } from "#src/platform/account-auth.native.js";
import { googleAuthorizationParams } from "#src/platform/account-auth.web.js";

/**
 * Prepares Secure Storage for the account session, writing its Keychain items readable after the
 * device's first unlock instead of only while it is unlocked: a token refresh during background
 * audio with the screen locked can then read the session and persist the rotated refresh token.
 * Items written before keep their accessibility, stay readable, and take the new one on their next
 * write, the session's next refresh.
 */
export async function initializeAuthStorage(storageKeys: readonly string[]) {
  const authStorage = await initializeSecureAuthStorage(storageKeys);
  const { KeychainAccess } = await import("@aparajita/capacitor-secure-storage");
  await authStorage.storage.setDefaultKeychainAccess(KeychainAccess.afterFirstUnlock);
  return authStorage;
}

/**
 * Where Supabase sends the browser back after Google: the app's own scheme, which the native
 * `WebAuthentication` plugin waits for. Supabase's redirect allow-list must contain it.
 */
const IOS_AUTH_CALLBACK_URL = "audio.cup.app://auth/callback";

type WebAuthenticationPlugin = {
  /**
   * Opens `url` in an `ASWebAuthenticationSession`, which shares Safari's cookies, and resolves
   * with the `audio.cup.app:` URL the sign-in ended at. Rejects when the listener cancels.
   */
  authenticate(options: { url: string }): Promise<{ url: string }>;
};

const webAuthentication = registerPlugin<WebAuthenticationPlugin>("WebAuthentication");

/**
 * Signs in through Supabase's OAuth flow with PKCE, as on the web, but in a system browser sheet
 * instead of the WebView: Google refuses sign-in in embedded WebViews, and Safari cannot return to
 * `capacitor://localhost`. The sheet hands the authorization code back to Cup without a page load.
 */
export async function signInWithGoogle(
  client: SupabaseClient,
  _googleClientId: string | undefined,
  fresh: boolean,
) {
  const authorization = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: IOS_AUTH_CALLBACK_URL,
      skipBrowserRedirect: true,
      queryParams: googleAuthorizationParams(fresh),
    },
  });
  if (authorization.error) {
    throw authorization.error;
  }
  const { url } = await webAuthentication.authenticate({ url: authorization.data.url });
  const exchange = await client.auth.exchangeCodeForSession(authorizationCode(url));
  if (exchange.error) {
    throw exchange.error;
  }
}

/** Nothing to end: Cup keeps no Google sign-in of its own; the sheet's cookies are Safari's. */
export async function clearNativeSignIn(): Promise<void> {}

/**
 * Reads the authorization code from the callback URL, or throws Supabase's error description, which
 * it puts in the query or the fragment.
 */
function authorizationCode(callbackUrl: string): string {
  const callback = new URL(callbackUrl);
  const code = callback.searchParams.get("code");
  if (code !== null && code !== "") {
    return code;
  }
  const fragment = new URLSearchParams(callback.hash.slice(1));
  const description =
    callback.searchParams.get("error_description") ?? fragment.get("error_description");
  throw new Error(description ?? "Sign-in did not complete.");
}
