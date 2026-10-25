import { test } from "vitest";

import {
  createGrantResponseSchema,
  listGrantsResponseSchema,
  LOCAL_OPERATOR_ACCESS_TOKEN,
} from "@cup/operator-api.routes";

import { useWorker } from "#test/use-worker.ts";

const DEVELOPMENT_OPERATOR_HEADERS = {
  "Cf-Access-Token": LOCAL_OPERATOR_ACCESS_TOKEN,
  "Content-Type": "application/json",
};

/**
 * Both concurrent tests below reuse this ID; if they shared storage, one would get
 * "already-issued".
 */
const SHARED_REQUEST_ID = "4a0c2b4e-8f5d-4c39-9a51-0d7f3c2e6b18";

// libs/api-server tests inject the operator access check; only the production default export wires
// the Cloudflare Access validation that must not accept the development token on a public hostname.
test("the development operator token works on localhost but not on the canonical domain", async ({
  expect,
  onTestFinished,
}) => {
  const worker = await useWorker({ onTestFinished });

  const localResponse = await worker.fetch("http://localhost/api/operator/grants", {
    headers: DEVELOPMENT_OPERATOR_HEADERS,
  });
  const productionResponse = await worker.fetch("https://cup.audio/api/operator/grants", {
    headers: DEVELOPMENT_OPERATOR_HEADERS,
  });

  expect(localResponse.status).toBe(200);
  expect(productionResponse.status).toBe(401);
  expect(await productionResponse.json()).toMatchObject({
    error: { code: "operator-unauthorized" },
  });
});

test.for(["first", "second"])(
  "the %s concurrent test issues a grant into its own empty Durable Object storage",
  async (label, { expect, onTestFinished }) => {
    const worker = await useWorker({ onTestFinished });

    const createResponse = await worker.fetch("http://localhost/api/operator/grants", {
      method: "POST",
      headers: DEVELOPMENT_OPERATOR_HEADERS,
      body: JSON.stringify({ label, requestId: SHARED_REQUEST_ID }),
    });
    const listResponse = await worker.fetch("http://localhost/api/operator/grants", {
      headers: DEVELOPMENT_OPERATOR_HEADERS,
    });

    expect(createResponse.status).toBe(201);
    const created = createGrantResponseSchema.parse(await createResponse.json());
    expect(created.result).toBe("issued");
    expect(listGrantsResponseSchema.parse(await listResponse.json()).grants).toStrictEqual([
      expect.objectContaining({ grantId: created.grantId, label, state: "open" }),
    ]);
    expect(await worker.listDurableObjectIds("CONVERSION_GRANTS")).toHaveLength(1);
  },
);
