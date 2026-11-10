import { App } from "@capacitor/app";

/**
 * Calls `listener` with whether the app is in the foreground: once with its current state, then on
 * each change. Returns a function that stops listening.
 */
export function watchAppState(listener: (isActive: boolean) => void): () => void {
  let isWatching = true;
  let hasReportedChange = false;
  const registration = App.addListener("appStateChange", ({ isActive }) => {
    hasReportedChange = true;
    if (isWatching) {
      listener(isActive);
    }
  });
  const reportCurrentState = async () => {
    const { isActive } = await App.getState();
    // A change reported while the state was being read is newer than the state read.
    if (isWatching && !hasReportedChange) {
      listener(isActive);
    }
  };
  void reportCurrentState();
  return () => {
    isWatching = false;
    void registration.then((handle) => handle.remove());
  };
}

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
