import { Capacitor } from "@capacitor/core";

export function apiOrigin(): string {
  return Capacitor.isNativePlatform() ? "https://cup.audio" : window.location.origin;
}
