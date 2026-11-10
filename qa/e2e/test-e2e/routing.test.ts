import { expect, gotoPage, test } from "#test-e2e/fixtures.ts";

const SOURCE_URL = "https://source.example.test/fixture";

for (const oldOrigin of [
  "https://cup-audio.com",
  "https://create-audiobook-from-url.patricktree.me",
]) {
  test(`carries trial credentials across the redirect from ${oldOrigin} and redeems them`, async ({
    browserName,
    page,
    workerEnvironment,
  }) => {
    // The old origin can only be emulated by fulfilling its route with the Worker's 308, so this
    // runs in Chromium alone. A redirect keeping the URL fragment is specified by the Fetch Standard.
    test.skip(
      browserName === "webkit",
      "Playwright's WebKit cannot fulfill a route with a redirect status",
    );
    await page.route(`${oldOrigin}/**`, async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({
        url: `${workerEnvironment.origin}${url.pathname}${url.search}`,
        headers: { ...route.request().headers(), host: url.host },
        maxRedirects: 0,
      });
      expect(response.status()).toBe(308);
      expect(response.headers()["location"]).toBe(`https://cup.audio${url.pathname}${url.search}`);
      // Assert the production destination, then keep the browser on the isolated test Worker.
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          location: `${workerEnvironment.origin}${url.pathname}${url.search}`,
        },
      });
    });
    for (const prefix of ["/trials", "/app/trials"]) {
      const grant = await workerEnvironment.createGrant();
      const credential = new URL(grant.trialLink).hash;
      const exchangeResponse = page.waitForResponse((response) =>
        response.url().endsWith(`/api/grants/${grant.grantId}/sessions`),
      );
      await gotoPage(page, `${oldOrigin}${prefix}/${grant.grantId}?from=email${credential}`);
      const exchange = await exchangeResponse;
      expect(exchange.status()).toBe(201);
      expect(exchange.request().postDataJSON()).toEqual({
        credential: new URLSearchParams(credential.slice(1)).get("credential"),
      });
      await expect(page.getByRole("heading", { name: "Just Listen." })).toBeVisible();
      await expect(page).toHaveURL(`${workerEnvironment.origin}/app/trials/${grant.grantId}`);
      await page.reload();
      await expect(page.getByRole("heading", { name: "Just Listen." })).toBeVisible();
    }
  });
}

test("redirects the homepage, app entry, and legacy trial URLs", async ({
  request,
  workerEnvironment,
}) => {
  for (const [pathname, status, location] of [
    ["/", 302, "/app/"],
    ["/?from=home", 302, "/app/?from=home"],
    ["/app", 308, "/app/"],
    ["/app?from=link", 308, "/app/?from=link"],
    ["/trials/existing", 308, "/app/trials/existing"],
    ["/trials/existing?from=email&tag=a&tag=b", 308, "/app/trials/existing?from=email&tag=a&tag=b"],
  ] as const) {
    const response = await request.get(`${workerEnvironment.origin}${pathname}`, {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(status);
    expect(response.headers()["location"]).toBe(location);
  }
});

test("follows homepage and app entry redirects and loads assets under app", async ({
  page,
  workerEnvironment,
}) => {
  for (const pathname of ["/", "/app"]) {
    await gotoPage(page, `${workerEnvironment.origin}${pathname}`);
    await expect(page).toHaveURL(`${workerEnvironment.origin}/app/`);
    await expect(page.getByRole("heading", { name: "Just listen." })).toBeVisible();
  }

  const assetPaths = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter(
        (entry) => !(entry instanceof PerformanceResourceTiming && entry.initiatorType === "fetch"),
      )
      .map((entry) => new URL(entry.name).pathname),
  );
  expect(assetPaths.some((pathname) => pathname.startsWith("/app/assets/"))).toBe(true);
  expect(assetPaths.every((pathname) => pathname.startsWith("/app/"))).toBe(true);
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute(
    "href",
    "/app/favicon.svg",
  );
});

test("exchanges a legacy trial link's credential after redirect and supports refresh", async ({
  page,
  workerEnvironment,
}) => {
  const grant = await workerEnvironment.createGrant();
  const legacyUrl = new URL(grant.trialLink);
  expect(legacyUrl.pathname).toBe(`/app/trials/${grant.grantId}`);
  const credential = new URLSearchParams(legacyUrl.hash.slice(1)).get("credential");
  legacyUrl.pathname = `/trials/${grant.grantId}`;
  legacyUrl.search = "?from=email&tag=a&tag=b";

  const redirectedRequest = page.waitForRequest(
    (request) =>
      request.isNavigationRequest() && new URL(request.url()).pathname.startsWith("/app/trials/"),
  );
  const exchangeResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/grants/${grant.grantId}/sessions`),
  );
  await gotoPage(page, legacyUrl.href);
  expect(new URL((await redirectedRequest).url()).search).toBe(legacyUrl.search);
  const exchange = await exchangeResponse;
  expect(exchange.ok()).toBe(true);
  expect(exchange.request().postDataJSON()).toEqual({ credential });
  await expect(page.getByRole("heading", { name: "Just Listen." })).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  expect(new URL(page.url()).pathname).toBe(`/app/trials/${grant.grantId}`);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Just Listen." })).toBeVisible();
});

test("returns real 404s outside the app and for missing assets", async ({
  request,
  workerEnvironment,
}) => {
  for (const pathname of [
    "/conversions/old",
    "/audiobooks/old",
    "/application",
    "/unrelated",
    "/index.html",
    "/favicon.svg",
    "/assets/missing.js",
    "/app/assets/missing.js",
    "/app/assets/missing",
    "/app/missing.svg",
  ]) {
    const response = await request.get(`${workerEnvironment.origin}${pathname}`, {
      headers: { "Sec-Fetch-Mode": "navigate", Accept: "text/html" },
    });
    expect(response.status(), pathname).toBe(404);
    expect(await response.text()).not.toContain('<div id="root">');
  }

  const apiResponse = await request.get(`${workerEnvironment.origin}/api/missing`);
  expect(apiResponse.status()).toBe(404);
  expect(apiResponse.headers()["content-type"]).toContain("application/json");
});

test("signed out, Recents and its dialogs redirect home, account recovery offers sign-in, and the old History and account pages are gone", async ({
  page,
  workerEnvironment,
}) => {
  const { origin } = workerEnvironment;
  for (const pathname of ["/app/recent", "/app/recent/add", "/app/recent/account"]) {
    await gotoPage(page, `${origin}${pathname}`);
    await expect(page).toHaveURL(`${origin}/app/`);
    await expect(page.getByRole("heading", { name: "Just listen." })).toBeVisible();
  }

  // The scheduled-deletion email links the account recovery page, where the listener signs in.
  await gotoPage(page, `${origin}/app/account-recovery`);
  await expect(page.getByRole("heading", { name: "Restore your account" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Google", exact: true }),
  ).toBeVisible();

  for (const pathname of ["/app/history", "/app/account"]) {
    await gotoPage(page, `${origin}${pathname}`);
    await expect(page.getByText("Not Found", { exact: true })).toBeVisible();
  }
});

test("a Google sign-in from the home page's sign-in link lands on Recents", async ({
  page,
  workerEnvironment,
}) => {
  const { origin, authProvider } = workerEnvironment;
  await gotoPage(page, `${origin}/app/`);
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Sign in", exact: true });
  await expect(dialog).toHaveAccessibleDescription("Sign in to get back to your tracks.");
  await dialog.getByRole("button", { name: "Continue with Google", exact: true }).click();

  await expect(page).toHaveURL(`${origin}/app/recent`);
  await expect(page.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();
  expect(authProvider.exchanges()).toBe(1);
});

test("after a cancelled submission, a Google sign-in from the sign-in link lands on Recents, not on the submitted URL", async ({
  page,
  workerEnvironment,
}) => {
  const { origin, authProvider } = workerEnvironment;
  await gotoPage(page, `${origin}/app/`);
  await page.getByRole("textbox", { name: "URL", exact: true }).fill(SOURCE_URL);
  await page.getByRole("button", { name: "Listen" }).click();
  const dialog = page.getByRole("dialog", { name: "Sign in", exact: true });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await dialog.getByRole("button", { name: "Continue with Google", exact: true }).click();

  await expect(page).toHaveURL(`${origin}/app/recent`);
  await expect(page.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();
  expect(authProvider.exchanges()).toBe(1);
});

test.describe("with the local test account", () => {
  test.use({ offersTestAccount: true });

  test("a test-account sign-in from the sign-in link replaces home with Recents without a page load", async ({
    page,
    workerEnvironment,
  }) => {
    const { origin, authProvider } = workerEnvironment;
    await gotoPage(page, `${origin}/app/`);
    const historyLength = await page.evaluate(() => window.history.length);
    // A page load would drop this marker.
    await page.evaluate(() => Object.assign(window, { isSamePage: true }));
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Sign in", exact: true })
      .getByRole("button", { name: "Sign in with test account", exact: true })
      .click();

    await expect(page).toHaveURL(`${origin}/app/recent`);
    await expect(page.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();
    expect(authProvider.exchanges()).toBe(1);
    expect(await page.evaluate(() => "isSamePage" in window)).toBe(true);
    // Recents replaced the signed-out home page's history entry, so Back leaves the app.
    expect(await page.evaluate(() => window.history.length)).toBe(historyLength);
    await page.goBack();
    await expect(page).toHaveURL("about:blank");
  });
});

test("signed in, home redirects to Recents, which opens the account dialog and the masked Add dialog", async ({
  page,
  workerEnvironment,
}) => {
  test.setTimeout(90_000);
  const { origin } = workerEnvironment;
  await gotoPage(page, `${origin}/app/`);
  await page.getByRole("textbox", { name: "URL", exact: true }).fill(SOURCE_URL);
  await page.getByRole("button", { name: "Listen" }).click();
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/audiobooks\//, { timeout: 60_000 });

  await gotoPage(page, `${origin}/app/`);
  await expect(page).toHaveURL(`${origin}/app/recent`);
  const recents = page.getByRole("list", { name: "Tracks" }).getByRole("listitem");
  await expect(recents).toHaveCount(1);
  // The fake auth provider names the account holder "Reader Doe".
  await expect(page.getByRole("link", { name: "Account" })).toHaveText("rd", {
    useInnerText: true,
  });

  // The account dialog keeps its own URL, so a Google sign-in to confirm a change returns to it.
  const accountDialog = page.getByRole("dialog", { name: "Account settings" });
  await page.getByRole("link", { name: "Account" }).click();
  await expect(accountDialog).toBeVisible();
  await expect(page).toHaveURL(`${origin}/app/recent/account`);
  await accountDialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(accountDialog).toHaveCount(0);
  await expect(page).toHaveURL(`${origin}/app/recent`);

  const addDialog = page.getByRole("dialog", { name: "Add a track" });
  const addTab = page.getByRole("navigation", { name: "Tabs" }).getByRole("link", { name: "Add" });
  await addTab.click();
  await expect(addDialog).toBeVisible();
  await expect(page).toHaveURL(`${origin}/app/recent`);
  await page.reload();
  await expect(addDialog).toBeVisible();
  await expect(page).toHaveURL(`${origin}/app/recent`);
  await page.goBack();
  await expect(addDialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();
  await expect(page).toHaveURL(`${origin}/app/recent`);

  await addTab.click();
  await addDialog.getByRole("textbox", { name: "URL", exact: true }).fill(SOURCE_URL);
  await addDialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(addDialog).toHaveCount(0, { timeout: 60_000 });
  await expect(page).toHaveURL(`${origin}/app/recent`);
  await expect(recents).toHaveCount(2);
  // Recents lists the newest conversion first, as a card linking to its detail view.
  const newCard = recents.first().getByRole("link");
  const newCardPath = await newCard.getAttribute("href");
  await expect(recents.first().getByText("source.example.test", { exact: true })).toBeVisible();
  await newCard.click();
  await expect(page).toHaveURL(`${origin}${newCardPath}`);
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/app/recent`);
});
