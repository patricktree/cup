import { expect, test } from "@playwright/test";

import { ACCOUNT_SESSION_STORAGE_KEY } from "#src/data-fetching/account-session-storage.ts";

test.use({ serviceWorkers: "block" });

test("logout clears a cookie issued by an earlier pending media request", async ({ page }) => {
  let releaseIssuance: (() => void) | undefined;
  const issuanceHeld = new Promise<void>((resolve) => {
    releaseIssuance = resolve;
  });
  let markStarted: (() => void) | undefined;
  const issuanceStarted = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  await page.route("**/api/auth/config", (route) =>
    route.fulfill({
      json: {
        supabaseUrl: "https://auth.example.com",
        publishableKey: "test-key",
        googleWebClientId: "test-client",
      },
    }),
  );
  await page.route("https://auth.example.com/auth/v1/logout**", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route("**/api/files/session", async (route) => {
    if (route.request().method() === "POST") {
      markStarted?.();
      await issuanceHeld;
      await route.fulfill({
        status: 204,
        headers: {
          "Set-Cookie": "cup_media=old-session; Path=/api/files; HttpOnly; SameSite=Lax",
        },
      });
    } else {
      await route.fulfill({
        status: 204,
        headers: {
          "Set-Cookie": "cup_media=; Path=/api/files; Max-Age=0; HttpOnly; SameSite=Lax",
        },
      });
    }
  });
  await page.goto("/ui-gallery/index.html");
  await page.evaluate(async (storageKey) => {
    const payload = btoa(
      JSON.stringify({ sub: "f355f913-ba12-45d6-a7d2-4df95f7cf11f", exp: 4294967295 }),
    ).replaceAll("=", "");
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`,
        refresh_token: "test-refresh",
        token_type: "bearer",
        expires_at: 4294967295,
        expires_in: 300,
        user: { id: "f355f913-ba12-45d6-a7d2-4df95f7cf11f" },
      }),
    );
    const modulePath = "/src/data-fetching/account-session.ts";
    const sessions = await import(modulePath);
    await sessions.ensureAuthInitialized();
    Object.assign(window, { pendingIssuance: sessions.refreshPlaybackAuthorization() });
  }, ACCOUNT_SESSION_STORAGE_KEY);
  await issuanceStarted;
  await page.evaluate(async () => {
    const modulePath = "/src/data-fetching/account-session.ts";
    const sessions = await import(modulePath);
    Object.assign(window, { pendingLogout: sessions.signOut() });
  });
  releaseIssuance?.();
  await page.evaluate(async () => {
    if (!("pendingLogout" in window)) throw new Error("Missing pending logout");
    await window.pendingLogout;
  });
  expect((await page.context().cookies()).filter((cookie) => cookie.name === "cup_media")).toEqual(
    [],
  );
  expect(
    await page.evaluate(async (storageKey) => {
      const modulePath = "/src/data-fetching/account-session.ts";
      const sessions = await import(modulePath);
      return {
        session: sessions.sessionSnapshot(),
        stored: localStorage.getItem(storageKey),
      };
    }, ACCOUNT_SESSION_STORAGE_KEY),
  ).toEqual({ session: null, stored: null });
});

test("auth distinguishes loading, failure, and successful signed-out initialization", async ({
  page,
}) => {
  await page.route("**/api/auth/config", (route) => route.fulfill({ status: 503 }));
  await page.goto("/ui-gallery/index.html");
  expect(
    await page.evaluate(async () => {
      const modulePath = "/src/data-fetching/account-session.ts";
      const sessions = await import(modulePath);
      const initial = sessions.authStateSnapshot().status;
      await sessions.ensureAuthInitialized().catch(() => undefined);
      return { initial, failed: sessions.authStateSnapshot().status };
    }),
  ).toEqual({ initial: "loading", failed: "error" });
  await page.route("**/api/auth/config", (route) =>
    route.fulfill({
      json: {
        supabaseUrl: "https://auth.example.com",
        publishableKey: "test-key",
        googleWebClientId: "test-client",
      },
    }),
  );
  expect(
    await page.evaluate(async () => {
      const modulePath = "/src/data-fetching/account-session.ts";
      const sessions = await import(modulePath);
      await sessions.ensureAuthInitialized();
      let notifications = 0;
      const unsubscribe = sessions.subscribeAuthState(() => {
        notifications += 1;
      });
      await sessions.getFreshAccountSession();
      await sessions.getFreshAccountSession();
      unsubscribe();
      return { status: sessions.authStateSnapshot().status, notifications };
    }),
  ).toEqual({ status: "signed-out", notifications: 0 });
});

test("concurrent session reads share an SDK refresh and cannot restore a signed-out session", async ({
  page,
}) => {
  let releaseRefresh: (() => void) | undefined;
  const refreshHeld = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  let markRefreshStarted: (() => void) | undefined;
  const refreshStarted = new Promise<void>((resolve) => {
    markRefreshStarted = resolve;
  });
  let refreshRequests = 0;
  const subject = "f355f913-ba12-45d6-a7d2-4df95f7cf11f";
  const accessToken = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: subject, exp: 4294967295 })).toString("base64url")}.signature`;
  const storedSession = {
    access_token: accessToken,
    refresh_token: "test-refresh",
    token_type: "bearer",
    expires_at: 4294967295,
    expires_in: 300,
    user: { id: subject },
  };
  await page.route("**/api/auth/config", (route) =>
    route.fulfill({
      json: {
        supabaseUrl: "https://auth.example.com",
        publishableKey: "test-key",
        googleWebClientId: "test-client",
      },
    }),
  );
  await page.route("https://auth.example.com/auth/v1/token**", async (route) => {
    refreshRequests += 1;
    markRefreshStarted?.();
    await refreshHeld;
    await route.fulfill({ json: storedSession });
  });
  await page.route("https://auth.example.com/auth/v1/logout**", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route("**/api/files/session", (route) => route.fulfill({ status: 204 }));
  await page.goto("/ui-gallery/index.html");
  await page.evaluate(
    async ({ storageKey, stored }) => {
      localStorage.setItem(storageKey, JSON.stringify(stored));
      const modulePath = "/src/data-fetching/account-session.ts";
      const sessions = await import(modulePath);
      const client = await sessions.ensureAuthInitialized();
      await client.auth.stopAutoRefresh();
      localStorage.setItem(storageKey, JSON.stringify({ ...stored, expires_at: 1 }));
      Object.assign(window, {
        pendingReads: Promise.all([
          sessions.getFreshAccountSession(),
          sessions.getFreshAccountSession(),
        ]),
      });
    },
    { storageKey: ACCOUNT_SESSION_STORAGE_KEY, stored: storedSession },
  );
  await refreshStarted;
  await page.evaluate(async () => {
    const modulePath = "/src/data-fetching/account-session.ts";
    const sessions = await import(modulePath);
    Object.assign(window, { pendingLogout: sessions.signOut() });
  });
  releaseRefresh?.();
  expect(
    await page.evaluate(async (storageKey) => {
      if (!("pendingLogout" in window) || !("pendingReads" in window))
        throw new Error("Missing pending auth operations");
      await window.pendingLogout;
      const reads = await window.pendingReads;
      const modulePath = "/src/data-fetching/account-session.ts";
      const sessions = await import(modulePath);
      return {
        reads,
        stored: localStorage.getItem(storageKey),
        state: sessions.authStateSnapshot().status,
      };
    }, ACCOUNT_SESSION_STORAGE_KEY),
  ).toEqual({ reads: [null, null], stored: null, state: "signed-out" });
  expect(refreshRequests).toBe(1);
});
