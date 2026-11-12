import type { Page } from "@playwright/test";

import { expect, test } from "#src/test-utils/component-test.ts";

const GRANT_ID = "b4ad28a8-bbd7-46af-a17c-59527becd745";

test("renders an open Trial", { tag: "@visual" }, async ({ mount, page }) => {
  const component = await mount("routes/trials.$grantId/OpenGrant");
  await expect(page).toHaveTitle("Free trial · Cup");

  await expect(component.getByRole("heading", { name: "Just listen." })).toBeVisible();
  await expect(component.getByRole("textbox", { name: "URL", exact: true })).toBeVisible();
  await expect(component.getByRole("button", { name: "Listen" })).toBeDisabled();
  await expect(component).toHaveScreenshot("open-trial.png");
});

test("rejects a malformed Trial credential", { tag: "@visual" }, async ({ mount, page }) => {
  const component = await mount("routes/trials.$grantId/MalformedCredential");
  await expect(page).toHaveTitle("Free trial · Cup");

  await expect(
    component.getByRole("heading", { name: "This Trial Link is invalid." }),
  ).toBeVisible();
  await expect(component).toHaveScreenshot("malformed-credential.png");
});

test("rejects a Trial credential that the server finds invalid", async ({ mount }) => {
  const component = await mount("routes/trials.$grantId/InvalidCredential");
  await expect(
    component.getByRole("heading", { name: "This trial link is invalid." }),
  ).toBeVisible();
});

test("renders revoked-trial-link", { tag: "@visual" }, async ({ mount }) => {
  const component = await mount("routes/trials.$grantId/RevokedCredential");
  await expect(
    component.getByRole("heading", { name: "This trial link was revoked." }),
  ).toBeVisible();
  await expect(component).toHaveScreenshot("revoked-trial-link.png");
});

test("renders credential-exchange-error", { tag: "@visual" }, async ({ mount, page }) => {
  const component = await mount("routes/trials.$grantId/CredentialExchangeError");
  await expect(
    component.getByRole("heading", { name: "The trial link could not be opened." }),
  ).toBeVisible();
  await expect(component).toHaveScreenshot("credential-exchange-error.png");

  await expectTryAgainToReloadTheTrialWithoutItsCredential(page, async () => {
    await component.getByRole("button", { name: "Try again" }).click();
  });
});

test("renders grant-load-error", { tag: "@visual" }, async ({ mount, page }) => {
  const component = await mount("routes/trials.$grantId/GrantLoadError");
  await expect(page).toHaveTitle("Free trial · Cup");
  await expect(
    component.getByRole("heading", { name: "The trial link could not be opened." }),
  ).toBeVisible();
  await expect(component).toHaveScreenshot("grant-load-error.png");

  await expectTryAgainToReloadTheTrialWithoutItsCredential(page, async () => {
    await component.getByRole("button", { name: "Try again" }).click();
  });
});

test("renders grant-session-invalid", { tag: "@visual" }, async ({ mount }) => {
  const component = await mount("routes/trials.$grantId/GrantSessionInvalid");
  await expect(
    component.getByRole("heading", { name: "This browser no longer has access." }),
  ).toBeVisible();
  await expect(component.getByText("Open the original trial link again.")).toBeVisible();
  await expect(component).toHaveScreenshot("grant-session-invalid.png");
});

test("explains a missing grant session as lost access", async ({ mount }) => {
  const component = await mount("routes/trials.$grantId/GrantSessionRequired");
  await expect(
    component.getByRole("heading", { name: "This browser no longer has access." }),
  ).toBeVisible();
});

test("renders an invalid source URL", { tag: "@visual" }, async ({ mount }) => {
  const component = await mount("routes/trials.$grantId/OpenGrant");
  await component.getByRole("textbox", { name: /^URL/ }).fill("not a URL");
  await component.getByRole("textbox", { name: /^URL/ }).blur();
  await expect(component.getByRole("alert")).toHaveCount(0);
  await component.getByRole("button", { name: "Listen" }).click();
  await expect(component.getByRole("textbox", { name: /^URL/ })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(component.getByRole("button", { name: "Listen" })).toBeDisabled();
  await expect(component).toHaveScreenshot("invalid-article-url.png");
  await component.getByRole("textbox", { name: "URL", exact: true }).fill("https://example.com");
  await expect(component.getByRole("alert")).toHaveCount(0);
  await expect(component.getByRole("button", { name: "Listen" })).toBeEnabled();
});

test("renders a pending conversion start", { tag: "@visual" }, async ({ mount }) => {
  const component = await mount("routes/trials.$grantId/StartPending");
  await component
    .getByRole("textbox", { name: /^URL/ })
    .fill("https://source.example.test/fixture");
  await component.getByRole("button", { name: "Listen" }).click();
  await expect(component.getByRole("button", { name: "Starting conversion..." })).toBeDisabled();
  await expect(component.getByRole("textbox", { name: /^URL/ })).toHaveValue(
    "https://source.example.test/fixture",
  );
  await expect(component).toHaveScreenshot("start-pending.png");
});

test("starting a conversion requests the grant again, for its duration and conversions", async ({
  mount,
  page,
}) => {
  let isStarted = false;
  let grantRequestsAfterStart = 0;
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (request.method() === "POST" && /\/api\/grants\/[^/]+\/conversions$/.test(pathname)) {
      isStarted = true;
    }
    if (isStarted && request.method() === "GET" && /\/api\/grants\/[^/]+$/.test(pathname)) {
      grantRequestsAfterStart += 1;
    }
  });
  const component = await mount("routes/trials.$grantId/StartSucceeds");

  await component
    .getByRole("textbox", { name: "URL", exact: true })
    .fill("https://source.example.test/fixture");
  await component.getByRole("button", { name: "Listen" }).click();

  await expect(component.getByLabel("Preparing track")).toBeVisible();
  expect(grantRequestsAfterStart).toBe(1);
});

test("retrying a trial submission reuses its key and sends only the source URL", async ({
  mount,
  page,
}) => {
  const keys: Array<string | undefined> = [];
  const payloads: unknown[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/api\/grants\/[^/]+\/conversions$/.test(new URL(request.url()).pathname)
    ) {
      keys.push(request.headers()["idempotency-key"]);
      payloads.push(request.postDataJSON());
    }
  });
  const component = await mount("routes/trials.$grantId/StartUnavailable");
  const sourceUrl = "https://source.example.test/fixture";
  await component.getByRole("textbox", { name: "URL", exact: true }).fill(sourceUrl);
  for (const count of [1, 2]) {
    await component.getByRole("button", { name: "Listen" }).click();
    // A server failure carries no message meant for users.
    await expect(component.getByRole("alert")).toHaveText("The conversion could not start.");
    await expect.poll(() => keys.length).toBe(count);
  }
  expect(keys[0]).toBeTruthy();
  expect(keys).toEqual([keys[0], keys[0]]);
  expect(payloads).toEqual([{ sourceUrl }, { sourceUrl }]);
});

/**
 * Try again loads the trial page again as a new document, without the credential fragment, so the
 * reloaded page opens the Trial with the grant session instead of exchanging the credential again
 * ("renders an open Trial" shows that page). The gallery serves no app at the trial path, so the
 * reloaded document is answered with an empty page.
 */
async function expectTryAgainToReloadTheTrialWithoutItsCredential(
  page: Page,
  pressTryAgain: () => Promise<void>,
): Promise<void> {
  const { origin } = new URL(page.url());
  const trialUrl = `${origin}/app/trials/${GRANT_ID}`;
  let credentialExchanges = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/sessions")) {
      credentialExchanges += 1;
    }
  });
  await page.route(trialUrl, async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Reloaded</title>",
    });
  });
  const reload = page.waitForRequest(
    (request) => request.isNavigationRequest() && request.frame() === page.mainFrame(),
  );

  await pressTryAgain();

  expect((await reload).url()).toBe(trialUrl);
  await expect(page).toHaveURL(trialUrl);
  expect(credentialExchanges).toBe(0);
}
