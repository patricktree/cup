import fs from "node:fs/promises";
import { test } from "vitest";

import { WEB_APP_CSP_NONCE_PLACEHOLDER } from "@cup/listener-api.routes";

import { useWorker } from "#test/use-worker.ts";

/** The test runtime's stand-in for the built web app (wrangler.test.jsonc, `assets`). */
const FIXTURE_INDEX_HTML = await fs.readFile(new URL("assets/index.html", import.meta.url), "utf8");
const FIXTURE_CSS = await fs.readFile(
  new URL("assets/app/assets/fixture.css", import.meta.url),
  "utf8",
);

const SECURITY_HEADERS = {
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

test("a web app route without a file serves the shell with a fresh CSP nonce per response", async ({
  expect,
  onTestFinished,
}) => {
  const worker = await useWorker({ onTestFinished });

  const responses = await Promise.all([worker.fetch("/app/recent"), worker.fetch("/app/recent")]);
  const nonces = await Promise.all(
    responses.map(async (response) => {
      const nonce = response.headers
        .get("Content-Security-Policy")
        ?.match(/script-src 'self' 'nonce-([^']+)'/)?.[1];
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(nonce).toBeDefined();
      expect(await response.text()).toBe(
        FIXTURE_INDEX_HTML.replaceAll(WEB_APP_CSP_NONCE_PLACEHOLDER, nonce ?? ""),
      );
      return nonce;
    }),
  );

  expect(new Set(nonces).size).toBe(2);
});

test("the CSP lets the web app connect to the configured Supabase origin", async ({
  expect,
  onTestFinished,
}) => {
  const worker = await useWorker({
    onTestFinished,
    vars: { SUPABASE_URL: "https://project.supabase.example/auth/v1" },
  });

  const response = await worker.fetch("/app/");

  expect(response.headers.get("Content-Security-Policy")).toContain(
    "connect-src 'self' https://project.supabase.example;",
  );
});

test("a web app file is served unchanged with its own content type and the security headers", async ({
  expect,
  onTestFinished,
}) => {
  const worker = await useWorker({ onTestFinished });

  const response = await worker.fetch("/app/assets/fixture.css");

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toMatch(/^text\/css/);
  expect(Object.fromEntries(response.headers)).toMatchObject(SECURITY_HEADERS);
  expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  expect(await response.text()).toBe(FIXTURE_CSS);
});

test("the CSP lets the web app play media only from the API's file routes", async ({
  expect,
  onTestFinished,
}) => {
  const worker = await useWorker({ onTestFinished });

  const response = await worker.fetch("/app/audiobooks/c4be3f43-4a43-4d6b-9a3f-6f0d2f6e2d51");

  // The API shares the web app's origin, which the narration track's signed URL points at.
  expect(response.headers.get("Content-Security-Policy")).toMatch(
    /(?:^|; )media-src https?:\/\/[^/;\s]+\/api\/files\/(?:;|$)/,
  );
});
