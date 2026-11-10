import { expect, test } from "vitest";

import { useMobileApp } from "#src/fixtures.ts";

const app = useMobileApp();

test("launches to the landing page, loaded from the test Worker", async () => {
  await app.device.launch({ apiOrigin: app.apiOrigin });
  const webView = await app.device.webView();

  // The start form is the signed-out landing page; the WebView rendered a route.
  await webView.$("button=Listen").waitForDisplayed({ timeout: 30_000 });
  expect(await webView.execute(() => window.location.pathname)).toBe("/app/");

  expect(app.worker.requests()).toContainEqual(
    expect.objectContaining({ method: "GET", path: "/api/auth/config" }),
  );
});
