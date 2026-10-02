import { expect, test } from "@playwright/test";

import { ACCOUNT_SESSION_STORAGE_KEY } from "#src/data-fetching/account-session-storage.ts";

test.use({ serviceWorkers: "block" });

test("a late rate-limit response cannot change the next account's pending request", async ({
  page,
}) => {
  await page.route("**/api/auth/config", (route) =>
    route.fulfill({
      json: {
        supabaseUrl: "https://auth.example.com",
        publishableKey: "test-key",
        googleWebClientId: "test-client",
      },
    }),
  );
  await page.addInitScript((storageKey) => {
    const subject = "880ce5b5-6542-40fd-8f2d-380f3066e98a";
    const payload = btoa(JSON.stringify({ sub: subject, exp: 4102444800 })).replaceAll("=", "");
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        access_token: "eyJhbGciOiJIUzI1NiJ9." + payload + ".fixture",
        refresh_token: "test-refresh",
        token_type: "bearer",
        expires_at: 4102444800,
        expires_in: 300,
        user: { id: subject },
      }),
    );
  }, ACCOUNT_SESSION_STORAGE_KEY);
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route("**/api/account/conversions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    requests += 1;
    await held;
    await route.fulfill({
      status: 429,
      headers: { "Retry-After": "1" },
      json: { error: { message: "Try again shortly." } },
    });
  });
  const otherSubject = "f355f913-ba12-45d6-a7d2-4df95f7cf11f";
  await page.route("https://auth.example.com/auth/v1/user", (route) =>
    route.fulfill({ json: { id: otherSubject, email: "other@example.test" } }),
  );
  await page.goto("/ui-gallery/index.html");
  await page.evaluate(async () => {
    if (!("mount" in window) || typeof window.mount !== "function")
      throw new Error("Gallery is unavailable");
    await window.mount({ story: "routes/index/LandingPage" });
  });
  const component = page.locator("main");
  await component.getByRole("textbox", { name: "URL", exact: true }).fill("https://example.com/");
  await component.getByRole("button", { name: "Load & listen" }).click();
  await expect.poll(() => requests).toBe(1);
  await page.evaluate(async (subject) => {
    const path = "/src/data-fetching/account-session.ts";
    const client = await (await import(path)).ensureAuthInitialized();
    const payload = btoa(JSON.stringify({ sub: subject, exp: 4102444800 })).replaceAll("=", "");
    const { error } = await client.auth.setSession({
      access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.fixture`,
      refresh_token: "other-refresh",
    });
    if (error) throw error;
    const pendingPath = "/src/data-fetching/account-conversion-storage.ts";
    const pending = await import(pendingPath);
    const request = pending.readPendingAccountConversion();
    if (!request) throw new Error("Expected the original request to remain");
    pending.storePendingAccountConversion({ ...request, submitted: true });
  }, otherSubject);
  release?.();
  await expect(component.getByRole("alert")).toHaveText("Try again shortly.");
  expect(
    await page.evaluate(async () => {
      const path = "/src/data-fetching/account-conversion-storage.ts";
      return (await import(path)).readPendingAccountConversion()?.submitted;
    }),
  ).toBe(true);
});
