// iOS auth is deferred; preserve the existing browser behavior until native support is added.
export {
  initializeAuthStorage,
  addAuthResumeListener,
  signInWithGoogle,
  setNativeMediaSession,
  clearNativeAuthSession,
} from "#src/platform/account-auth.web.js";
