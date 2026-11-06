import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

import { handleShareLink } from "#src/platform/share-links.js";

export async function initializeIosIncomingUrls(
  navigate: (href: string) => void,
  onShare: () => void | Promise<void>,
): Promise<void> {
  if (Capacitor.getPlatform() !== "ios") {
    return;
  }

  let receivedEvent = false;
  await App.addListener("appUrlOpen", ({ url }) => {
    receivedEvent = true;
    handleShareLink(url, navigate, onShare);
  });
  const launch = await App.getLaunchUrl();
  // A launch URL may also arrive as an event while the listener is registering.
  if (!receivedEvent && launch !== undefined) {
    handleShareLink(launch.url, navigate, onShare);
  }
}
