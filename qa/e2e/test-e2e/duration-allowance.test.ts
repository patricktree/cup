import type { Page } from "@playwright/test";
import { unzipSync } from "fflate";

import { analyzeMp3 } from "@cup/audiobook-production";
import { grantSnapshotSchema } from "@cup/conversion-grants/contracts";
import { conversionDetailSchema, startConversionResponseSchema } from "@cup/web-app-api.routes";

import { expect, test, type WorkerEnvironment } from "#test-e2e/fixtures.ts";
import { openNewTrial, startConversion, waitForAudiobook } from "#test-e2e/journey.ts";

const DEFAULT_ALLOWANCE_MILLISECONDS = 7_200_000;

test("deducts actual encoded audio duration once across reloads and downloads", async ({
  page,
  workerEnvironment,
}) => {
  const { grantId } = await openNewTrial(page, workerEnvironment);
  expect((await readGrant(page, grantId)).duration).toEqual({
    availableMilliseconds: DEFAULT_ALLOWANCE_MILLISECONDS,
    reservedMilliseconds: 0,
    spentMilliseconds: 0,
  });
  await startConversion(page);
  await waitForAudiobook(page);
  const epubUrl = await page.getByRole("link", { name: "Download EPUB" }).getAttribute("href");
  if (epubUrl === null) throw new Error("EPUB download URL missing");
  const epubResponse = await fetch(new URL(epubUrl, page.url()));
  expect(epubResponse.status).toBe(200);
  const archive = unzipSync(new Uint8Array(await epubResponse.arrayBuffer()));
  const audioSegments = Object.entries(archive).filter(([name]) =>
    /^EPUB\/audio\/\d+\.mp3$/u.test(name),
  );
  expect(audioSegments.length).toBeGreaterThan(0);
  // Each stored segment is billed using its encoded duration, rounded up independently.
  const actualMilliseconds = audioSegments.reduce(
    (sum, [, audio]) => sum + Math.ceil(analyzeMp3(audio).durationMilliseconds),
    0,
  );
  const before = await readGrant(page, grantId);
  expect(before.duration).toEqual({
    availableMilliseconds: DEFAULT_ALLOWANCE_MILLISECONDS - actualMilliseconds,
    reservedMilliseconds: 0,
    spentMilliseconds: actualMilliseconds,
  });
  const providerCalls = await readSpeechCalls(workerEnvironment);
  expect(providerCalls).toHaveLength(audioSegments.length);
  await page.reload();
  await waitForAudiobook(page);
  await page.locator("audio").evaluate(async (element) => {
    if (!(element instanceof HTMLAudioElement)) throw new Error("Audio player missing");
    await element.play();
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Download MP3" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("audiobook.mp3");
    expect(await download.failure()).toBeNull();
  }
  expect((await readGrant(page, grantId)).duration).toEqual(before.duration);
  expect(await readSpeechCalls(workerEnvironment)).toEqual(providerCalls);
});

test("blocks oversized synthesis without calling the provider or deducting allowance", async ({
  page,
  workerEnvironment,
}) => {
  const { grantId } = await openNewTrial(page, workerEnvironment);
  await setAllowance(workerEnvironment, grantId, 1_000);
  await startConversion(page);
  await expect(page.getByRole("heading", { name: "Conversion failed.", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  const conversionId = new URL(page.url()).pathname.split("/").at(-1);
  if (conversionId === undefined) throw new Error("Conversion ID missing");
  expect(await readConversion(page, conversionId)).toMatchObject({
    status: "failed",
    failure: { category: "narration-synthesis" },
  });
  expect(await readSpeechCalls(workerEnvironment)).toEqual([]);
  expect((await readGrant(page, grantId)).duration).toEqual({
    availableMilliseconds: 1_000,
    reservedMilliseconds: 0,
    spentMilliseconds: 0,
  });
});

test.describe("concurrent duration reservations", () => {
  test.use({ qaScenario: "speech-gated" });

  test("shares reservations across conversions and caps aggregate overruns at the allowance", async ({
    page,
    workerEnvironment,
  }) => {
    test.setTimeout(60_000);
    const { grantId } = await openNewTrial(page, workerEnvironment);
    const allowance = 10_000;
    await setAllowance(workerEnvironment, grantId, allowance);
    const responses = await page.evaluate(
      async (id) =>
        Promise.all(
          [0, 1].map(async () => {
            const response = await fetch(`/api/grants/${id}/conversions`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Create-Audiobook-From-URL-Request": "1",
                "Idempotency-Key": crypto.randomUUID(),
              },
              body: JSON.stringify({ sourceUrl: "https://source.example.test/fixture" }),
            });
            return { status: response.status, body: await response.json() };
          }),
        ),
      grantId,
    );
    const conversionIds = responses.map((response) => {
      expect(response.status).toBe(202);
      return startConversionResponseSchema.parse(response.body).conversion.conversionId;
    });
    await expect
      .poll(
        async () => {
          const calls = await readSpeechCalls(workerEnvironment);
          const reserved = calls.reduce(
            (sum, call) => sum + Math.max(1_000, call.characters * 80),
            0,
          );
          const grant = await readGrant(page, grantId);
          return (
            calls.length >= 2 &&
            reserved <= allowance &&
            grant.duration.reservedMilliseconds === reserved &&
            grant.duration.availableMilliseconds === allowance - reserved &&
            grant.duration.spentMilliseconds === 0
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    const heldCalls = await readSpeechCalls(workerEnvironment);
    // Either conversion may win reservations; both draw from the same allowance.
    expect(heldCalls.every((call) => conversionIds.includes(call.conversionId))).toBe(true);
    const release = await fetch(`${workerEnvironment.origin}/__qa/release-speech`, {
      method: "POST",
    });
    expect(release.status).toBe(204);
    await expect
      .poll(
        async () => {
          const conversions = await Promise.all(
            conversionIds.map((id) => readConversion(page, id)),
          );
          return conversions.every((conversion) => conversion.status !== "pending");
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    const conversions = await Promise.all(conversionIds.map((id) => readConversion(page, id)));
    expect(
      conversions.some(
        (conversion) =>
          conversion.status === "failed" && conversion.failure.category === "narration-synthesis",
      ),
    ).toBe(true);
    // The gated provider delivers eight seconds per accepted request, exceeding the shared ten-second allowance.
    expect((await readGrant(page, grantId)).duration).toEqual({
      availableMilliseconds: 0,
      reservedMilliseconds: 0,
      spentMilliseconds: allowance,
    });
    expect(await readSpeechCalls(workerEnvironment)).toEqual(heldCalls);
  });
});

async function readGrant(page: Page, grantId: string) {
  return grantSnapshotSchema.parse(
    await page.evaluate(async (id) => (await fetch(`/api/grants/${id}`)).json(), grantId),
  );
}

async function readConversion(page: Page, conversionId: string) {
  return conversionDetailSchema.parse(
    await page.evaluate(async (id) => (await fetch(`/api/conversions/${id}`)).json(), conversionId),
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
  if (!Array.isArray(value) || !value.every(isSpeechCall))
    throw new Error("Invalid QA speech call report");
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
