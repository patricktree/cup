import { Capacitor } from "@capacitor/core";

import * as android from "#src/platform/account-auth.android.js";
import * as ios from "#src/platform/account-auth.ios.js";
import * as web from "#src/platform/account-auth.web.js";

const platform = Capacitor.getPlatform();
export const initializeAuthStorage =
  platform === "android"
    ? android.initializeAuthStorage
    : platform === "ios"
      ? ios.initializeAuthStorage
      : web.initializeAuthStorage;
export const addAuthResumeListener =
  platform === "android"
    ? android.addAuthResumeListener
    : platform === "ios"
      ? ios.addAuthResumeListener
      : web.addAuthResumeListener;
export const signInWithGoogle =
  platform === "android"
    ? android.signInWithGoogle
    : platform === "ios"
      ? ios.signInWithGoogle
      : web.signInWithGoogle;
export const setNativeMediaSession =
  platform === "android"
    ? android.setNativeMediaSession
    : platform === "ios"
      ? ios.setNativeMediaSession
      : web.setNativeMediaSession;
export const clearNativeAuthSession =
  platform === "android"
    ? android.clearNativeAuthSession
    : platform === "ios"
      ? ios.clearNativeAuthSession
      : web.clearNativeAuthSession;
