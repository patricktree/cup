import React from "react";
import ReactDOM from "react-dom/client";

import { AppStyles } from "#src/app/app-styles.js";
import { createAppRouter, GlobalProviders } from "#src/app/global-providers.js";
import { sessionSnapshot } from "#src/data-fetching/account-session.js";
import { initializeAndroidAppLinks } from "#src/platform/app-links.android.js";
import { initializeAndroidBackButton } from "#src/platform/back-button.android.js";
import { initializeIosIncomingUrls } from "#src/platform/incoming-urls.ios.js";
import { initializeAndroidShare } from "#src/platform/share-plugin.android.js";
import { trialBrowserState } from "#src/trial-browser-state.js";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Expected #root element to exist.");
}

const router = createAppRouter();

await initializeAndroidBackButton(router.history);

await Promise.all([
  initializeAndroidAppLinks((href) => router.history.push(href)).catch((error: unknown) => {
    console.error("Failed to initialize Android App Links", error);
  }),
  initializeAndroidShare(navigateToAccountConversionOrTrialConversion).catch((error: unknown) => {
    console.error("Failed to initialize Android share intake", error);
  }),
  initializeIosIncomingUrls(
    (href) => router.history.push(href),
    navigateToAccountConversionOrTrialConversion,
  ).catch((error: unknown) => {
    console.error("Failed to initialize iOS incoming URL handling", error);
  }),
]);

async function navigateToAccountConversionOrTrialConversion(): Promise<void> {
  if (sessionSnapshot()) {
    await router.navigate({ to: "/" });
    return;
  }
  const lastGrantId = trialBrowserState.getLastGrantId();
  if (lastGrantId !== null) {
    await router.navigate({ to: "/trials/$grantId", params: { grantId: lastGrantId } });
  } else {
    await router.navigate({ to: "/" });
  }
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AppStyles />
    <GlobalProviders router={router} />
  </React.StrictMode>,
);
