import fs from "node:fs/promises";
import { test } from "vitest";

import { useWorker } from "#test/use-worker.ts";
import { PRODUCTION_CONFIG_PATH, readWranglerConfig } from "#test/wrangler-configs.ts";

/** The canonical custom domain; wrangler-config.test.ts checks that wrangler.jsonc routes it. */
const CANONICAL_ORIGIN = "https://cup.audio";

/** The test runtime's stand-in for the built web app shell (wrangler.test.jsonc, `assets`). */
const FIXTURE_INDEX_HTML = await fs.readFile(new URL("assets/index.html", import.meta.url), "utf8");

/** Every custom domain of the production config other than the canonical one. */
const REDIRECTED_HOSTNAMES = readProductionRouteHostnames().filter(
  (hostname) => hostname !== new URL(CANONICAL_ORIGIN).hostname,
);

test.for(REDIRECTED_HOSTNAMES)(
  "the custom domain %s of wrangler.jsonc redirects permanently to the canonical domain",
  async (hostname, { expect, onTestFinished }) => {
    const worker = await useWorker({ onTestFinished });

    const response = await worker.fetch(`https://${hostname}/app/trials/existing?from=email`, {
      method: "POST",
      redirect: "manual",
    });

    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe(
      `${CANONICAL_ORIGIN}/app/trials/existing?from=email`,
    );
  },
);

test("the canonical domain serves the web app instead of redirecting", async ({
  expect,
  onTestFinished,
}) => {
  const worker = await useWorker({ onTestFinished });

  const response = await worker.fetch(`${CANONICAL_ORIGIN}/app/recent`, { redirect: "manual" });

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toMatch(/^text\/html/);
});

test.for([
  { path: "/api/unknown", contentType: /^application\/json/ },
  { path: "/app/assets/missing.css", contentType: null },
  { path: "/index.html", contentType: /^text\/plain/ },
])(
  "$path answers 404 rather than falling back to the web app shell",
  async ({ path, contentType }, { expect, onTestFinished }) => {
    const worker = await useWorker({ onTestFinished });

    const response = await worker.fetch(path);

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toEqual(
      contentType === null ? null : expect.stringMatching(contentType),
    );
    expect(await response.text()).not.toBe(FIXTURE_INDEX_HTML);
  },
);

function readProductionRouteHostnames(): string[] {
  return (readWranglerConfig(PRODUCTION_CONFIG_PATH).routes ?? []).map((route) => {
    if (route.custom_domain !== true) {
      throw new Error(
        `Expected only custom-domain routes in wrangler.jsonc, got ${route.pattern}.`,
      );
    }
    return route.pattern;
  });
}
