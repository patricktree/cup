// iOS auth is deferred; preserve the existing browser behavior until native support is added.
export {
  initializeAuthStorage,
  signInWithGoogle,
  clearNativeSignIn,
} from "#src/platform/account-auth.web.js";
