import { expect, test, type Page } from "@playwright/test";

import { ACCOUNT_SESSION_STORAGE_KEY } from "#src/auth/account-session-storage.ts";

test.use({ serviceWorkers: "block" });

const SUBJECT = "880ce5b5-6542-40fd-8f2d-380f3066e98a";
const GRANT_ID = "b4ad28a8-bbd7-46af-a17c-59527becd745";
const CONVERSION_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

async function routeAuthConfig(page: Page) {
  await page.route("**/api/auth/config", (route) =>
    route.fulfill({
      json: {
        supabaseUrl: "https://auth.example.com",
        publishableKey: "test-key",
        googleWebClientId: "test-client",
      },
    }),
  );
}

async function signIn(page: Page) {
  await page.addInitScript(
    ({ storageKey, subject }) => {
      const payload = btoa(JSON.stringify({ sub: subject, exp: 4102444800 })).replaceAll("=", "");
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.fixture`,
          refresh_token: "test-refresh",
          token_type: "bearer",
          expires_at: 4102444800,
          expires_in: 300,
          user: { id: subject },
        }),
      );
    },
    { storageKey: ACCOUNT_SESSION_STORAGE_KEY, subject: SUBJECT },
  );
}

/** Records the Authorization header of each audiobook request and answers it with an error. */
async function recordAudiobookAuthorization(page: Page) {
  const authorization: Array<string | null> = [];
  await page.route(`**/api/audiobooks/${CONVERSION_ID}`, async (route) => {
    authorization.push((await route.request().headerValue("authorization")) ?? null);
    await route.fulfill({ status: 404, json: {} });
  });
  return authorization;
}

type ApiRequestModule = typeof import("#src/data-fetching/api-request.ts");

test("unsuccessful responses reject with the API error code, status, and retry delay", async ({
  page,
}) => {
  let response = 0;
  await page.route(`**/api/grants/${GRANT_ID}`, (route) => {
    response += 1;
    if (response === 1) {
      return route.fulfill({
        status: 429,
        headers: { "Retry-After": "7" },
        json: {
          error: {
            code: "rate-limited",
            message: "Try again shortly.",
            requestId: "09e6d824-d41d-43bb-9417-18f89232ba56",
          },
        },
      });
    }
    if (response === 2) {
      return route.fulfill({
        status: 401,
        json: { error: { code: "grant-session-invalid", message: "No access." } },
      });
    }
    return route.fulfill({ status: 502, contentType: "text/html", body: "<h1>Bad gateway</h1>" });
  });
  await page.goto("/ui-gallery/index.html");
  const failures = await page.evaluate(async (grantId) => {
    const path = "/src/data-fetching/api-request.ts";
    const { requestApi, RpcError }: ApiRequestModule = await import(path);
    const results = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const failure: unknown = await requestApi("none", (client) =>
        client.getGrant({ grantId }),
      ).then(
        () => null,
        (error: unknown) => error,
      );
      if (!(failure instanceof RpcError)) {
        throw new Error("Expected an RpcError");
      }
      const { code, message, status, retryAfter } = failure;
      results.push({ code, message, status, retryAfter });
    }
    return results;
  }, GRANT_ID);
  expect(failures).toEqual([
    { code: "rate-limited", message: "Try again shortly.", status: 429, retryAfter: 7 },
    { code: "grant-session-invalid", message: "No access.", status: 401, retryAfter: 60 },
    {
      code: "operational-error",
      message: "The request could not be completed.",
      status: 502,
      retryAfter: 60,
    },
  ]);
});

test("optional account authorization sends no token while signed out", async ({ page }) => {
  await page.route("**/api/auth/config", (route) => route.fulfill({ status: 503 }));
  const authorization = await recordAudiobookAuthorization(page);
  await page.goto("/ui-gallery/index.html");
  const status = await page.evaluate(async (conversionId) => {
    const path = "/src/data-fetching/api-request.ts";
    const { requestApi, RpcError }: ApiRequestModule = await import(path);
    return requestApi("optional", (client) => client.getAudiobook({ conversionId })).then(
      () => null,
      (error: unknown) => (error instanceof RpcError ? error.status : null),
    );
  }, CONVERSION_ID);
  expect(status).toBe(404);
  expect(authorization).toEqual([null]);
});

test("optional account authorization sends the signed-in account's token", async ({ page }) => {
  await routeAuthConfig(page);
  await signIn(page);
  const authorization = await recordAudiobookAuthorization(page);
  await page.goto("/ui-gallery/index.html");
  await page.evaluate(async (conversionId) => {
    const path = "/src/data-fetching/api-request.ts";
    const { requestApi }: ApiRequestModule = await import(path);
    await requestApi("optional", (client) => client.getAudiobook({ conversionId })).catch(
      () => undefined,
    );
  }, CONVERSION_ID);
  expect(authorization).toHaveLength(1);
  expect(authorization[0]).toMatch(/^Bearer eyJ/);
});

test("required account authorization rejects a different account before dispatch", async ({
  page,
}) => {
  await routeAuthConfig(page);
  await signIn(page);
  const authorization: Array<string | null> = [];
  await page.route("**/api/account", async (route) => {
    authorization.push(await route.request().headerValue("authorization"));
    await route.fulfill({ json: { marker: "account" } });
  });
  await page.goto("/ui-gallery/index.html");
  const results = await page.evaluate(async (subject) => {
    const path = "/src/data-fetching/api-request.ts";
    const { requestApi }: ApiRequestModule = await import(path);
    const other = await requestApi({ subject: "f355f913-ba12-45d6-a7d2-4df95f7cf11f" }, (client) =>
      client.getAccount(),
    ).then(
      () => "sent",
      (error: unknown) => (error instanceof Error ? error.message : "unknown"),
    );
    const own: unknown = await requestApi({ subject }, (client) => client.getAccount());
    return { other, own };
  }, SUBJECT);
  expect(results).toEqual({ other: "Sign in to continue.", own: { marker: "account" } });
  expect(authorization).toHaveLength(1);
  expect(authorization[0]).toMatch(/^Bearer eyJ/);
});
