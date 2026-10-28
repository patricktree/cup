import { expect, gotoPage, test } from "#test-e2e/fixtures.ts";

const SOURCE_URL = "https://source.example.test/fixture";

for (const oldOrigin of [
  "https://cup-audio.com",
  "https://create-audiobook-from-url.patricktree.me",
]) {
  test(`carries trial credentials across the redirect from ${oldOrigin} and redeems them`, async ({
    page,
    workerEnvironment,
  }) => {
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

  const association = await request.get(`${workerEnvironment.origin}/.well-known/assetlinks.json`, {
    maxRedirects: 0,
  });
  expect(association.status()).toBe(200);
  expect(association.headers()["content-type"]).toContain("application/json");
});

test("signed out, Recents and the Add dialog redirect home, the account dialog offers sign-in, and the old History and account pages are gone", async ({
  page,
  workerEnvironment,
}) => {
  const { origin } = workerEnvironment;
  for (const pathname of ["/app/recent", "/app/recent/add"]) {
    await gotoPage(page, `${origin}${pathname}`);
    await expect(page).toHaveURL(`${origin}/app/`);
    await expect(page.getByRole("heading", { name: "Just listen." })).toBeVisible();
  }

  // The scheduled-deletion email links the account dialog, where the listener signs in.
  await gotoPage(page, `${origin}/app/recent/account`);
  await expect(page).toHaveURL(`${origin}/app/recent/account`);
  await expect(
    page
      .getByRole("dialog", { name: "Account settings" })
      .getByRole("button", { name: "Continue with Google", exact: true }),
  ).toBeVisible();

  for (const pathname of ["/app/history", "/app/account"]) {
    await gotoPage(page, `${origin}${pathname}`);
    await expect(page.getByText("Not Found", { exact: true })).toBeVisible();
  }
});

test("signed in, home redirects to Recents, which opens the account dialog and the masked Add dialog", async ({
  page,
  workerEnvironment,
}) => {
  test.setTimeout(90_000);
  const { origin } = workerEnvironment;
  await gotoPage(page, `${origin}/app/`);
  await page.getByRole("textbox", { name: "URL", exact: true }).fill(SOURCE_URL);
  await page.getByRole("button", { name: "Load & listen" }).click();
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
