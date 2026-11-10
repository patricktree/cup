/**
 * Prepares Secure Storage for the account session, which is kept under `storageKeys`. Both shells
 * keep the session there, so the platform's keychain or keystore protects it; the iOS adapter sets
 * the Keychain accessibility.
 */
export async function initializeAuthStorage(storageKeys: readonly string[]) {
  const storage = (await import("@aparajita/capacitor-secure-storage")).SecureStorage;
  return {
    storage,
    detectSessionInUrl: false,
    clearStoredSession: async () => {
      for (const key of storageKeys) {
        await storage.removeItem(key);
      }
    },
  };
}
