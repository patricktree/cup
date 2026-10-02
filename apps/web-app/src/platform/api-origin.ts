import { Capacitor } from "@capacitor/core";

export function apiOrigin(): string {
  return Capacitor.isNativePlatform() ? "https://cup-audio.com" : window.location.origin;
}
