import type { Page } from "@playwright/test";

import { audiobookSchema, type Audiobook } from "@cup/listener-api.routes";

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
        if ("title" in audiobook) {
          prepared = audiobook;
        }
        return audiobook.status;
      },
      { timeout: 90_000 },
    )
    .not.toBe("pending");
  if (!prepared) {
    throw new Error("Expected a prepared audiobook.");
  }
  return prepared;
}

/**
 * Synthesis starts by itself after preparation; waits until every segment has audio. Returns each
 * segment's settled duration, as the narration track's start offsets lay them out.
 */
export async function waitForGeneratedAudio(page: Page, conversionId: string, token?: string) {
  await expect
    .poll(async () => (await readAudiobook(page, conversionId, token)).status, { timeout: 90_000 })
    .toBe("ready");
  const audiobook = await readAudiobook(page, conversionId, token);
  if (audiobook.status !== "ready" || !audiobook.narrationTrack) {
    throw new Error("Expected generated audio to remain ready.");
  }
  for (const segment of audiobook.segments) {
    if (segment.status !== "ready") {
      throw new Error(`Segment ${segment.sequence} has no audio.`);
    }
  }

  const { startMilliseconds, durationMilliseconds } = audiobook.narrationTrack;
  return startMilliseconds.map((start, sequence) => ({
    sequence,
    durationMilliseconds: (startMilliseconds[sequence + 1] ?? durationMilliseconds) - start,
  }));
}

/** One synthesis request the QA Worker's tracked speech provider received. */
export type SpeechCall = { conversionId: string; sequence: number; characters: number };

/** Reads every synthesis request the QA Worker's tracked speech provider received. */
export async function readSpeechCalls(origin: string): Promise<SpeechCall[]> {
  const response = await fetch(`${origin}/__qa/speech-calls`);
  expect(response.status).toBe(200);
  const value: unknown = await response.json();
  if (!Array.isArray(value) || !value.every(isSpeechCall)) {
    throw new Error("Invalid QA speech call report");
  }
  return value;
}

/**
 * Counts the audio segments that reached the speech provider. Under speech policy 7 every segment
 * after the first sends an overlap take and then, since the QA Worker's fake tone has no pause to
 * cut in, its narration chunk alone, so one segment makes up to two requests.
 */
export function countSynthesizedSegments(calls: readonly SpeechCall[]): number {
  return new Set(calls.map(({ conversionId, sequence }) => `${conversionId}/${sequence}`)).size;
}

function isSpeechCall(value: unknown): value is SpeechCall {
  return (
    typeof value === "object" &&
    value !== null &&
    "conversionId" in value &&
    typeof value.conversionId === "string" &&
    "sequence" in value &&
    typeof value.sequence === "number" &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 0 &&
    "characters" in value &&
    typeof value.characters === "number" &&
    Number.isSafeInteger(value.characters) &&
    value.characters > 0
  );
}
