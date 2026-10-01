import { expect, test } from "vitest";

import { useWorkerEnvironment } from "#test-vitest/fixtures.ts";

const workerEnvironment = useWorkerEnvironment();

test("exchanges persistent cookies and authorizes native requests without a browser origin", async () => {
  const { origin } = workerEnvironment;
  const grant = await workerEnvironment.createTrial();
  const response = await fetch(`${origin}/api/grants/${grant.grantId}/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Create-Audiobook-From-URL-Request": "1",
    },
    body: JSON.stringify({ credential: grant.credential }),
  });
  expect(response.status).toBe(201);
  expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const cookie = response.headers.get("Set-Cookie");
  expect(cookie).toContain("Max-Age=");
  const headers = { Cookie: cookie!.split(";")[0]! };
  const snapshot = await fetch(`${origin}/api/grants/${grant.grantId}`, { headers });
  expect(snapshot.status).toBe(200);
  expect(snapshot.headers.get("Set-Cookie")).toContain("HttpOnly");
  const history = await fetch(`${origin}/api/grants/${grant.grantId}/conversions`, { headers });
  expect(history.status).toBe(200);
  expect(history.headers.get("Set-Cookie")).toContain("HttpOnly");

  const start = await fetch(`${origin}/api/grants/${grant.grantId}/conversions`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "X-Create-Audiobook-From-URL-Request": "1",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({ sourceUrl: "https://source.example.test/fixture" }),
  });
  expect(start.status).toBe(202);
  const started: unknown = await start.json();
  if (typeof started !== "object" || started === null || !("conversion" in started)) {
    throw new Error("Missing conversion");
  }
  const conversion = started.conversion;
  if (
    typeof conversion !== "object" ||
    conversion === null ||
    !("conversionId" in conversion) ||
    typeof conversion.conversionId !== "string"
  ) {
    throw new Error("Missing conversion ID");
  }
  const detail = await fetch(`${origin}/api/conversions/${conversion.conversionId}`, { headers });
  expect(detail.status).toBe(200);
  expect(detail.headers.get("Set-Cookie")).toContain("HttpOnly");
  const otherGrant = await workerEnvironment.createTrial();
  expect((await fetch(`${origin}/api/grants/${otherGrant.grantId}`, { headers })).status).toBe(401);

  const revocation = await fetch(`${origin}/api/operator/grants/${grant.grantId}/revocation`, {
    method: "POST",
    headers: { "Cf-Access-Token": "local-access-token", "Content-Type": "application/json" },
    body: "{}",
  });
  expect(revocation.status).toBe(200);
  expect((await fetch(`${origin}/api/grants/${grant.grantId}`, { headers })).status).toBe(200);
  const revokedStart = await fetch(`${origin}/api/grants/${grant.grantId}/conversions`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "X-Create-Audiobook-From-URL-Request": "1",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({ sourceUrl: "https://source.example.test/fixture" }),
  });
  expect(revokedStart.status).toBe(403);
});
