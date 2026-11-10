import type { SupabaseClient } from "@supabase/supabase-js";

import { SignInCancelledError, UserFacingError } from "#src/errors.js";
import type { GoogleSignInOptions } from "#src/platform/account-auth.web.js";
export { initializeAuthStorage, watchAppState } from "#src/platform/account-auth.native.js";

/**
 * Messages of the plugin's cancellation code that mean the person backed out. Google Play services
 * reports some failures, such as a missing Android OAuth client ("[16] Account reauth failed."),
 * with the same code, so only these messages count as the person's choice.
 */
const CANCELLED_BY_PERSON_MESSAGES = new Set([
  // Google Play services' detail when the person leaves its add-account or account-picker screen.
  "[16] Cancelled by user.",
  // The plugin's own message when Google gives no detail.
  "The user canceled the sign-in flow.",
]);

/**
 * Ignores `chooseAccount`: sign-out already ends the device's Google sign-in (`clearNativeSignIn`),
 * so Credential Manager shows its account picker on the next sign-in anyway.
 *
 * Rejects with a `SignInCancelledError` when the person backs out of Google's screens, and with a
 * `UserFacingError` for any other failure of the plugin.
 */
export async function signInWithGoogle(
  client: { auth: Pick<SupabaseClient["auth"], "signInWithIdToken"> },
  googleClientId: string | undefined,
  { fresh }: GoogleSignInOptions,
) {
  const { GoogleSignIn, ErrorCode } = await import("@capawesome/capacitor-google-sign-in");
  if (!googleClientId) {
    throw new Error("Sign-in is temporarily unavailable.");
  }
  await GoogleSignIn.initialize({ clientId: googleClientId });
  const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = Array.from(nonceBytes, (value) => value.toString(16).padStart(2, "0")).join("");
  const hashedNonce = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce))),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
  if (fresh) {
    await GoogleSignIn.signOut();
  }
  let result;
  try {
    result = await GoogleSignIn.signIn({ nonce: hashedNonce });
  } catch (error) {
    if (isCancelledByPerson(error, ErrorCode.SignInCanceled)) {
      throw new SignInCancelledError({ cause: error });
    }
    throw new UserFacingError({
      title: "Google sign-in could not be completed. Try again.",
      cause: error,
    });
  }
  const exchange = await client.auth.signInWithIdToken({
    provider: "google",
    token: result.idToken,
    nonce,
  });
  if (exchange.error) {
    throw exchange.error;
  }
}

/** Signs out of Google on the device, so the next sign-in can pick another account. */
export async function clearNativeSignIn(): Promise<void> {
  const { GoogleSignIn } = await import("@capawesome/capacitor-google-sign-in");
  await GoogleSignIn.signOut();
}

/**
 * `cancellationCode` is the plugin's `ErrorCode.SignInCanceled`, which only its lazily loaded
 * module provides.
 */
function isCancelledByPerson(error: unknown, cancellationCode: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === cancellationCode &&
    CANCELLED_BY_PERSON_MESSAGES.has(error.message)
  );
}
