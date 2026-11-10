import { Capacitor } from "@capacitor/core";

import * as android from "#src/platform/account-auth.android.js";
import * as ios from "#src/platform/account-auth.ios.js";
import * as web from "#src/platform/account-auth.web.js";

/**
 * `fresh` authenticates again however recent the last authentication was, such as before account
 * deletion. `chooseAccount` shows Google's account chooser, which the session lifecycle asks for on
 * the first sign-in after a sign-out on this device.
 */
export type GoogleSignInOptions = { fresh: boolean; chooseAccount: boolean };

const platform = Capacitor.getPlatform();
export const initializeAuthStorage =
  platform === "android"
    ? android.initializeAuthStorage
    : platform === "ios"
      ? ios.initializeAuthStorage
      : web.initializeAuthStorage;
export const signInWithGoogle =
  platform === "android"
    ? android.signInWithGoogle
    : platform === "ios"
      ? ios.signInWithGoogle
      : web.signInWithGoogle;
export const watchAppState =
  platform === "android"
    ? android.watchAppState
    : platform === "ios"
      ? ios.watchAppState
      : web.watchAppState;
export const clearNativeSignIn =
  platform === "android"
    ? android.clearNativeSignIn
    : platform === "ios"
      ? ios.clearNativeSignIn
      : web.clearNativeSignIn;
