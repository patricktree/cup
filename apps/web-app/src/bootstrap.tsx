import React from "react";
import ReactDOM from "react-dom/client";

import { AppStyles } from "#src/app/app-styles.js";
import { createAppRouter, GlobalProviders } from "#src/app/global-providers.js";
import { ensureAuthInitialized, sessionSnapshot } from "#src/auth/account-session.js";
import { initializeAndroidBackButton } from "#src/platform/back-button.android.js";
import { initializeIosIncomingUrls } from "#src/platform/incoming-urls.ios.js";
import { initializeAndroidShare } from "#src/platform/share-plugin.android.js";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Expected #root element to exist.");
}

const router = createAppRouter();

await initializeAndroidBackButton(router.history);

await Promise.all([
  initializeAndroidShare(navigateToConversionForShare).catch((error: unknown) => {
    console.error("Failed to initialize Android share intake", error);
  }),
  initializeIosIncomingUrls(navigateToConversionForShare).catch((error: unknown) => {
    console.error("Failed to initialize iOS incoming URL handling", error);
  }),
]);

async function navigateToConversionForShare(): Promise<void> {
  // A share can arrive at app start, before the restored session is known; failing auth counts as signed out.
  await ensureAuthInitialized().catch((error: unknown) => {
    console.error("Failed to restore the account session before taking a share", error);
  });
  if (sessionSnapshot()) {
    // The Add dialog takes the shared URL; leaving it replaces this entry with Recents.
    await router.navigate({ to: "/recent/add" });
    return;
  }
  // The mobile apps intentionally don't support trial links, so a signed-out listener has no trial
  // here; the shared URL waits until a conversion form is opened.
  await router.navigate({ to: "/" });
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AppStyles />
    <GlobalProviders router={router} />
  </React.StrictMode>,
);
