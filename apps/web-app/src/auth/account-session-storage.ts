export const ACCOUNT_SESSION_STORAGE_KEY = "cup_supabase_session";
export const ACCOUNT_SESSION_CODE_VERIFIER_STORAGE_KEY = `${ACCOUNT_SESSION_STORAGE_KEY}-code-verifier`;
/**
 * Set by sign-out until the next Google sign-in succeeds; kept apart from the session's own keys,
 * which sign-out clears.
 */
export const ACCOUNT_CHOOSER_MARKER_STORAGE_KEY = "cup_choose_account_next";
