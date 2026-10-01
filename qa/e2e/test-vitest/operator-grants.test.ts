import { expect, test } from "vitest";

import { useWorkerEnvironment } from "#test-vitest/fixtures.ts";

const workerEnvironment = useWorkerEnvironment();

test("updates only the selected grant allowance through the authenticated operator API", async () => {
  const { origin } = workerEnvironment;
  const headers = { "Content-Type": "application/json", "Cf-Access-Token": "local-access-token" };
  const response = await fetch(`${origin}/api/operator/grants`, {
    method: "POST",
    headers,
    body: JSON.stringify({ label: "Allowance test", requestId: crypto.randomUUID() }),
  });
  expect(response.status).toBe(201);
  const created: unknown = await response.json();
  if (
    typeof created !== "object" ||
    created === null ||
    !("grantId" in created) ||
    typeof created.grantId !== "string"
  )
    throw new Error("Grant creation did not return an ID");
  const url = `${origin}/api/operator/grants/${created.grantId}/allowance`;
  expect(
    (
      await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowanceMilliseconds: 20 }),
      })
    ).status,
  ).toBe(401);
  for (const allowanceMilliseconds of [0, -1, 1.5])
    expect(
      (
        await fetch(url, {
          method: "PUT",
          headers,
          body: JSON.stringify({ allowanceMilliseconds }),
        })
      ).status,
    ).toBe(400);
  const updated = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify({ allowanceMilliseconds: 20 }),
  });
  expect(updated.status).toBe(200);
  await expect(updated.json()).resolves.toMatchObject({
    changed: true,
    grant: {
      duration: { availableMilliseconds: 20, reservedMilliseconds: 0, spentMilliseconds: 0 },
    },
  });
  const inspected = await fetch(`${origin}/api/operator/grants/${created.grantId}`, { headers });
  await expect(inspected.json()).resolves.toMatchObject({
    authoritative: { duration: { availableMilliseconds: 20 } },
    registrySnapshotDisagreement: false,
  });
  const missing = await fetch(`${origin}/api/operator/grants/${crypto.randomUUID()}/allowance`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ allowanceMilliseconds: 20 }),
  });
  expect(missing.status).toBe(404);
});
