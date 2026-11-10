import { expect, test } from "vitest";

import { useMobileApp } from "#src/fixtures.ts";
import { SOURCE_URL, signInFromLandingPage, waitForRecents } from "#src/journeys.ts";

/**
 * Native networking through `CapacitorHttp`: the app's requests reach the Worker from native code,
 * which sends no Origin header, and the Worker's mutation check accepts them by the custom header
 * and the JSON content type.
 *
 * Android only: iOS sign-in does not work in the app yet (CUP-60), and this test needs a signed-in
 * listener. The iOS half joins once CUP-60 lands.
 */
const app = useMobileApp();

test("a conversion started from the Add dialog reaches the Worker through native networking", async () => {
  await app.device.launch({ apiOrigin: app.apiOrigin });
  const webView = await app.device.webView();
  await signInFromLandingPage(webView);
  await webView.$('a[aria-label="Back"]').click();
  await waitForRecents(webView, 1);

  const requestCount = app.worker.requests().length;
  await webView.$('nav[aria-label="Tabs"]').$("a*=Add").click();
  const addDialog = webView.$('[role="dialog"]');
  await addDialog.$('input[type="url"]').setValue(SOURCE_URL);
  await addDialog.$("button=Add").click();
  await addDialog.waitForExist({ reverse: true, timeout: 60_000 });

  await waitForRecents(webView, 2);
  const requests = app.worker.requests().slice(requestCount);
  const mutations = requests.filter(
    ({ method, path }) => method === "POST" && path === "/api/account/conversions",
  );
  expect(mutations).toHaveLength(1);
  const [mutation] = mutations;
  expect(mutation?.headers).not.toHaveProperty("origin");
  expect(mutation?.headers).toMatchObject({
    "content-type": "application/json",
    "x-create-audiobook-from-url-request": "1",
  });
  // Every account request since, the mutation and the reloads of Recents, carried the account's
  // token: one the test's fake auth provider signed for an authenticated account.
  const accountRequests = requests.filter(({ path }) => path.startsWith("/api/account/"));
  expect(accountRequests).toContainEqual(expect.objectContaining({ method: "GET" }));
  for (const { headers } of accountRequests) {
    expect(bearerTokenClaims(headers["authorization"])).toMatchObject({
      iss: `${app.authProviderOrigin}/auth/v1`,
      role: "authenticated",
    });
  }
});

/** Reads the claims of a `Bearer <JWT>` authorization header; the Worker checked its signature. */
function bearerTokenClaims(authorization: string | undefined): unknown {
  const payload = /^Bearer [^.\s]+\.([^.\s]+)\.[^.\s]+$/u.exec(authorization ?? "")?.[1];
  if (payload === undefined) {
    throw new Error(`The request carried no bearer token: ${String(authorization)}`);
  }
  return JSON.parse(Buffer.from(payload, "base64url").toString());
}
