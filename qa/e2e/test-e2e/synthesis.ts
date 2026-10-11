import type { Page } from "@playwright/test";

import { audiobookSchema, type Audiobook } from "@cup/web-app-api.routes";

import { expect } from "#test-e2e/fixtures.ts";
import { getTrialSessionHeaders } from "#test-e2e/journey.ts";

type PreparedAudiobook = Extract<Audiobook, { title: string }>;

export async function readAudiobook(page: Page, conversionId: string, token?: string) {
  const response = await page.request.get(
    new URL(`/api/audiobooks/${conversionId}`, page.url()).href,
    {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(await getTrialSessionHeaders(page)),
      },
    },
  );
  return audiobookSchema.parse(await response.json());
}

/** Waits for a prepared conversion, whatever the state of its audio. */
export async function waitForPreparedAudiobook(
  page: Page,
  conversionId: string,
  token?: string,
): Promise<PreparedAudiobook> {
  let prepared: PreparedAudiobook | undefined;
  await expect
    .poll(
      async () => {
        const audiobook = await readAudiobook(page, conversionId, token);
        if ("title" in audiobook) prepared = audiobook;
        return audiobook.status;
      },
      { timeout: 90_000 },
    )
    .not.toBe("pending");
  if (!prepared) throw new Error("Expected a prepared audiobook.");
  return prepared;
}

/** Synthesis starts by itself after preparation; waits until every segment has audio. */
export async function waitForGeneratedAudio(page: Page, conversionId: string, token?: string) {
  await expect
    .poll(async () => (await readAudiobook(page, conversionId, token)).status, { timeout: 90_000 })
    .toBe("ready");
  const audiobook = await readAudiobook(page, conversionId, token);
  if (audiobook.status !== "ready") throw new Error("Expected generated audio to remain ready.");

  return audiobook.segments.map((segment) => {
    if (segment.status !== "ready") throw new Error(`Segment ${segment.sequence} has no audio.`);
    return segment;
  });
}
