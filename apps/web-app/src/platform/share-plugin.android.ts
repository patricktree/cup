import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

import { receiveSharedUrl } from "#src/platform/share-intake.js";
import { extractSharedUrl } from "#src/platform/shared-url.js";

type AndroidSharePlugin = {
  addListener(
    eventName: "shareIntentReceived",
    listener: (payload: { text: string }) => void,
  ): Promise<PluginListenerHandle>;
};

const androidSharePlugin = registerPlugin<AndroidSharePlugin>("AndroidShare");
export async function initializeAndroidShare(onShare: () => void | Promise<void>): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") {
    return;
  }

  await androidSharePlugin.addListener("shareIntentReceived", ({ text }) => {
    const url = extractSharedUrl(text);
    if (url === undefined) {
      return;
    }
    receiveSharedUrl(url, onShare);
  });
}
