import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

export async function initializeAndroidBackButton(history: {
  canGoBack(): boolean;
  back(): void;
}): Promise<void> {
  if (Capacitor.getPlatform() !== "android") return;
  await App.addListener("backButton", () => {
    if (history.canGoBack()) history.back();
    else void App.minimizeApp();
  });
}
