import { expect, test } from "vitest";

import { useWorkerEnvironment } from "#test-vitest/fixtures.ts";

const workerEnvironment = useWorkerEnvironment();

test("rejects cross-origin browser mutations before they reach the grant", async () => {
  const { origin } = workerEnvironment;
  const response = await fetch(`${origin}/api/grants/${crypto.randomUUID()}/conversions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
      Origin: "https://example.com",
      "X-Create-Audiobook-From-URL-Request": "1",
    },
    body: JSON.stringify({ sourceUrl: "https://example.com/source" }),
  });
  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toMatchObject({ error: { code: "origin-forbidden" } });
});

test("returns 405 and Allow for unsupported methods on known API routes", async () => {
  const { origin } = workerEnvironment;
  const response = await fetch(`${origin}/api/grants/${crypto.randomUUID()}`, { method: "POST" });
  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("GET");
  await expect(response.json()).resolves.toMatchObject({ error: { code: "method-not-allowed" } });
});

test("rejects native-style mutations without the request marker or with a foreign origin", async () => {
  const { origin } = workerEnvironment;
  const grant = await workerEnvironment.createTrial();
  for (const headers of [
    { "Content-Type": "application/json" },
    {
      "Content-Type": "application/json",
      "X-Create-Audiobook-From-URL-Request": "1",
      Origin: "https://evil.example",
    },
    {
      "Content-Type": "application/json",
      "X-Create-Audiobook-From-URL-Request": "1",
      "Sec-Fetch-Site": "cross-site",
    },
  ]) {
    const response = await fetch(`${origin}/api/grants/${grant.grantId}/sessions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ credential: grant.credential }),
    });
    expect(response.status).toBe("X-Create-Audiobook-From-URL-Request" in headers ? 403 : 400);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  }
});
