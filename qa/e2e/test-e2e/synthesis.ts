import type { Page } from "@playwright/test";

import { audioSegmentSchema } from "@cup/web-app-api.routes";

import { expect } from "#test-e2e/fixtures.ts";
import { getTrialSessionHeaders } from "#test-e2e/journey.ts";

/** Request one unit explicitly without advancing the player or speculating ahead. */
export async function generateUnit(page: Page, conversionId: string, sequence = 0, token?: string) {
  const path = `/api/audiobooks/${conversionId}/segments/${sequence}`;
  const headers = {
    "Content-Type": "application/json",
    "X-Create-Audiobook-From-URL-Request": "1",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const response = await page.evaluate(
    async (input) => {
      const mutation = await fetch(input.path, {
        method: "POST",
        headers: input.headers,
        body: JSON.stringify({ retry: true }),
      });
      return { status: mutation.status, body: await mutation.json() };
    },
    { path, headers },
  );
  expect(response.status).toBe(200);
  const requestHeaders = { ...headers, ...(await getTrialSessionHeaders(page)) };
  await expect
    .poll(
      async () => {
        const statusResponse = await page.request.get(new URL(path, page.url()).href, {
          headers: requestHeaders,
        });
        const segment = audioSegmentSchema.parse(await statusResponse.json());
        if (segment.status === "failed") throw new Error(segment.explanation);
        return segment.status;
      },
      { timeout: 60_000 },
    )
    .toBe("ready");
  const segment = audioSegmentSchema.parse(
    await (
      await page.request.get(new URL(path, page.url()).href, { headers: requestHeaders })
    ).json(),
  );
  if (segment.status !== "ready") throw new Error("Expected generated audio to remain ready.");
  return segment;
}
