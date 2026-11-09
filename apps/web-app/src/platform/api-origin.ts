import { Capacitor } from "@capacitor/core";

/**
 * Set before the page loads only by the debug build of a native shell that the mobile E2E suite
 * launched with the test Worker's origin; release builds never set it.
 */
const TEST_API_ORIGIN_GLOBAL = "cupTestApiOrigin";

export function apiOrigin(): string {
  if (!Capacitor.isNativePlatform()) {
    return window.location.origin;
  }
  const testApiOrigin: unknown = Reflect.get(window, TEST_API_ORIGIN_GLOBAL);
  return typeof testApiOrigin === "string" ? testApiOrigin : "https://cup.audio";
}
