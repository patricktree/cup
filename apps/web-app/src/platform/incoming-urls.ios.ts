import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

import { handleAppLink } from "#src/platform/app-links.js";
import { handleShareLink } from "#src/platform/share-links.js";

export async function initializeIosIncomingUrls(
  navigate: (href: string) => void,
  onShare: () => void,
): Promise<void> {
  if (Capacitor.getPlatform() !== "ios") {
    return;
  }

  let receivedEvent = false;
  await App.addListener("appUrlOpen", ({ url }) => {
    receivedEvent = true;
    receive(url);
  });
  const launch = await App.getLaunchUrl();
  // A launch URL may also arrive as an event while the listener is registering.
  if (!receivedEvent && launch !== undefined) {
    receive(launch.url);
  }

  function receive(value: string): void {
    if (!handleAppLink(value, navigate)) {
      handleShareLink(value, navigate, onShare);
    }
  }
}
