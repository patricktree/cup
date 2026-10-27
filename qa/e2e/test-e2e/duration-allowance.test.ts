import type { Page } from "@playwright/test";

import { analyzeMp3 } from "@cup/audiobook-production";
import { estimateAudioDuration } from "@cup/conversion-contracts";
import { grantSnapshotSchema, startConversionResponseSchema } from "@cup/listener-api.routes";

import { expect, test, type WorkerEnvironment } from "#test-e2e/fixtures.ts";
import {
  getTrialSessionHeaders,
  openNewTrial,
  startConversion,
  waitForAudiobook,
} from "#test-e2e/journey.ts";
import { waitForGeneratedAudio, waitForPreparedAudiobook } from "#test-e2e/synthesis.ts";
const DEFAULT_ALLOWANCE_MILLISECONDS = 7_200_000;

test("charges every segment by encoded duration and reuses audio across reloads and retries", async ({
  page,
  workerEnvironment,
}) => {
  const { grantId } = await openNewTrial(page, workerEnvironment);
  await startConversion(page);
  await waitForAudiobook(page);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  const segments = await waitForGeneratedAudio(page, id);
  let actual = 0;
  for (const segment of segments) {
    const audio = new Uint8Array(
      await (
        await page.request.get(segment.url, { headers: await getTrialSessionHeaders(page) })
      ).body(),
    );
    actual += Math.ceil(analyzeMp3(audio).durationMilliseconds);
  }
  const before = await readGrant(page, grantId);
  expect(before.duration).toEqual({
    availableMilliseconds: DEFAULT_ALLOWANCE_MILLISECONDS - actual,
    reservedMilliseconds: 0,
    spentMilliseconds: actual,
  });
  const calls = await readSpeechCalls(workerEnvironment);
  expect(calls).toHaveLength(segments.length);
  await page.reload();
  await waitForAudiobook(page);
  const retries = await Promise.all([retrySynthesis(page, id), retrySynthesis(page, id)]);
  expect(retries.map((retry) => retry.status())).toEqual([200, 200]);
  expect((await readGrant(page, grantId)).duration).toEqual(before.duration);
  expect(await readSpeechCalls(workerEnvironment)).toEqual(calls);
});

test("a document exceeding the allowance stays readable, reserves nothing, and can be retried", async ({
  page,
  workerEnvironment,
}) => {
  const { grantId } = await openNewTrial(page, workerEnvironment);
  await setAllowance(workerEnvironment, grantId, 1_000);
  await startConversion(page);
  await waitForAudiobook(page);
  await expect(page.getByText(/Not enough audio duration for this article\./)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/and 1 s is available\./)).toBeVisible();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  expect(await readSpeechCalls(workerEnvironment)).toEqual([]);
  expect((await readGrant(page, grantId)).duration).toEqual({
    availableMilliseconds: 1_000,
    reservedMilliseconds: 0,
    spentMilliseconds: 0,
  });

  await setAllowance(workerEnvironment, grantId, DEFAULT_ALLOWANCE_MILLISECONDS);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled({
    timeout: 60_000,
  });
  expect((await readSpeechCalls(workerEnvironment)).length).toBeGreaterThan(0);
});

test.describe("in-flight reservations", () => {
  test.use({ qaScenario: "speech-gated" });
  test("reserves the whole document while every segment is generated at once", async ({
    page,
    workerEnvironment,
  }) => {
    const { grantId } = await openNewTrial(page, workerEnvironment);
    await startConversion(page);
    await waitForAudiobook(page);
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    const article = await waitForPreparedAudiobook(page, id);
    expect(article.status).toBe("synthesizing");
    const unitCount = article.narrationDocument.synchronizationUnits.length;
    expect(unitCount).toBeGreaterThan(1);
    // Every segment reaches the provider without waiting for another to finish.
    await expect
      .poll(async () => (await readSpeechCalls(workerEnvironment)).length)
      .toBe(unitCount);
    await expect(
      page.getByText(`Generating audio… 0 of ${unitCount} segments ready`),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
    const reserved = (await readGrant(page, grantId)).duration.reservedMilliseconds;
    expect(reserved).toBe(
      article.narrationDocument.synchronizationUnits.reduce(
        (total, unit) => total + estimateAudioDuration(unit.narrationText.length),
        0,
      ),
    );

    // A retry joins the synthesis in flight instead of reserving or synthesizing again.
    const retry = await retrySynthesis(page, id);
    expect(retry.status()).toBe(200);
    expect(await retry.json()).toEqual({ result: "started" });
    expect((await readGrant(page, grantId)).duration.reservedMilliseconds).toBe(reserved);

    await fetch(workerEnvironment.origin + "/__qa/release-speech", { method: "POST" });
    await expect
      .poll(async () => (await readGrant(page, grantId)).duration.reservedMilliseconds)
      .toBe(0);
    expect(await readSpeechCalls(workerEnvironment)).toHaveLength(unitCount);
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled({
      timeout: 30_000,
    });
  });
  test("a second conversion reserves nothing while the first holds the allowance, and overruns are capped", async ({
    page,
    workerEnvironment,
  }) => {
    const { grantId } = await openNewTrial(page, workerEnvironment);
    const start = async () => {
      const response = await browserPost(
        page,
        workerEnvironment.origin + "/api/grants/" + grantId + "/conversions",
        {
          headers: { ...mutationHeaders(), "Idempotency-Key": crypto.randomUUID() },
          data: { sourceUrl: "https://source.example.test/fixture" },
        },
      );
      expect(response.status()).toBe(202);
      return startConversionResponseSchema.parse(await response.json()).conversion.conversionId;
    };

    const first = await start();
    const article = await waitForPreparedAudiobook(page, first);
    expect(article.status).toBe("synthesizing");
    const reserved = (await readGrant(page, grantId)).duration.reservedMilliseconds;
    // Leave less than one more document's estimate beside the first conversion's reservation.
    const allowance = reserved + 1_000;
    await setAllowance(workerEnvironment, grantId, allowance);

    const second = await start();
    const blocked = await waitForPreparedAudiobook(page, second);
    if (blocked.status !== "insufficient-duration") {
      throw new Error("Expected the second conversion to lack duration.");
    }
    expect(blocked.requiredMilliseconds).toBe(reserved);
    expect(blocked.availableMilliseconds).toBe(1_000);
    expect((await readGrant(page, grantId)).duration.reservedMilliseconds).toBe(reserved);

    await fetch(workerEnvironment.origin + "/__qa/release-speech", { method: "POST" });
    const segments = await waitForGeneratedAudio(page, first);
    expect(segments).toHaveLength(article.narrationDocument.synchronizationUnits.length);
    // Charges follow the encoded audio and stop at the allowance when it runs longer than estimated.
    const spent = Math.min(
      allowance,
      segments.reduce((total, segment) => total + Math.ceil(segment.durationMilliseconds), 0),
    );
    expect((await readGrant(page, grantId)).duration).toEqual({
      availableMilliseconds: allowance - spent,
      reservedMilliseconds: 0,
      spentMilliseconds: spent,
    });
    expect(await readSpeechCalls(workerEnvironment)).toHaveLength(segments.length);
    // Preparation stays available without duration.
    await start();
  });
});
function retrySynthesis(page: Page, conversionId: string) {
  return browserPost(page, new URL(`/api/audiobooks/${conversionId}/retry`, page.url()).href, {
    headers: mutationHeaders(),
    data: {},
  });
}

function mutationHeaders() {
  return { "Content-Type": "application/json", "X-Create-Audiobook-From-URL-Request": "1" };
}

async function readGrant(page: Page, grantId: string) {
  return grantSnapshotSchema.parse(
    await page.evaluate(async (id) => (await fetch(`/api/grants/${id}`)).json(), grantId),
  );
}

async function setAllowance(
  worker: WorkerEnvironment,
  grantId: string,
  allowanceMilliseconds: number,
): Promise<void> {
  const response = await fetch(`${worker.origin}/api/operator/grants/${grantId}/allowance`, {
    method: "PUT",
    headers: { "Cf-Access-Token": "local-access-token", "Content-Type": "application/json" },
    body: JSON.stringify({ allowanceMilliseconds }),
  });
  expect(response.status).toBe(200);
}

type SpeechCall = { conversionId: string; characters: number };

async function readSpeechCalls(worker: WorkerEnvironment): Promise<SpeechCall[]> {
  const response = await fetch(`${worker.origin}/__qa/speech-calls`);
  expect(response.status).toBe(200);
  const value: unknown = await response.json();
  if (!Array.isArray(value) || !value.every(isSpeechCall)) {
    throw new Error("Invalid QA speech call report");
  }
  return value;
}

function isSpeechCall(value: unknown): value is SpeechCall {
  return (
    typeof value === "object" &&
    value !== null &&
    "conversionId" in value &&
    typeof value.conversionId === "string" &&
    "characters" in value &&
    typeof value.characters === "number" &&
    Number.isSafeInteger(value.characters) &&
    value.characters > 0
  );
}

async function browserPost(
  page: Page,
  url: string,
  options: { headers: Record<string, string>; data: unknown },
) {
  const response = await page.evaluate(
    async (input) => {
      const r = await fetch(input.url, {
        method: "POST",
        headers: input.options.headers,
        body: JSON.stringify(input.options.data),
      });
      return { status: r.status, body: await r.json() };
    },
    { url, options },
  );
  return { status: () => response.status, json: async () => response.body };
}
