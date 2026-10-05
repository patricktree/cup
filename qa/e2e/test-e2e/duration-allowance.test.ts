import type { Page } from "@playwright/test";

import { analyzeMp3 } from "@cup/audiobook-production";
import { grantSnapshotSchema } from "@cup/conversion-grants/contracts";
import {
  conversionDetailSchema,
  startConversionResponseSchema,
  audioSegmentSchema,
  audiobookSchema,
} from "@cup/web-app-api.routes";

import { expect, test, type WorkerEnvironment } from "#test-e2e/fixtures.ts";
import {
  getTrialSessionHeaders,
  openNewTrial,
  startConversion,
  waitForAudiobook,
} from "#test-e2e/journey.ts";
import { generateUnit } from "#test-e2e/synthesis.ts";
const DEFAULT_ALLOWANCE_MILLISECONDS = 7_200_000;

test("charges one unit by encoded duration and reuses it across reloads and duplicate requests", async ({
  page,
  workerEnvironment,
}) => {
  const { grantId } = await openNewTrial(page, workerEnvironment);
  await startConversion(page);
  await waitForAudiobook(page);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  const segment = await generateUnit(page, id);
  const audio = new Uint8Array(
    await (
      await page.request.get(segment.url, { headers: await getTrialSessionHeaders(page) })
    ).body(),
  );
  const actual = Math.ceil(analyzeMp3(audio).durationMilliseconds);
  const before = await readGrant(page, grantId);
  expect(before.duration).toEqual({
    availableMilliseconds: DEFAULT_ALLOWANCE_MILLISECONDS - actual,
    reservedMilliseconds: 0,
    spentMilliseconds: actual,
  });
  const calls = await readSpeechCalls(workerEnvironment);
  expect(calls).toHaveLength(1);
  await page.reload();
  await waitForAudiobook(page);
  await Promise.all([generateUnit(page, id), generateUnit(page, id)]);
  expect((await readGrant(page, grantId)).duration).toEqual(before.duration);
  expect(await readSpeechCalls(workerEnvironment)).toEqual(calls);
});

test("insufficient allowance leaves the article readable and blocks synthesis without provider expense", async ({
  page,
  workerEnvironment,
}) => {
  const { grantId } = await openNewTrial(page, workerEnvironment);
  await setAllowance(workerEnvironment, grantId, 1_000);
  await startConversion(page);
  await waitForAudiobook(page);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("not enough available audio duration");
  expect(await readSpeechCalls(workerEnvironment)).toEqual([]);
  expect((await readGrant(page, grantId)).duration).toEqual({
    availableMilliseconds: 1_000,
    reservedMilliseconds: 0,
    spentMilliseconds: 0,
  });
});

test.describe("in-flight reservations", () => {
  test.use({ qaScenario: "speech-gated" });
  test("Pause stops speech synthesis lookahead while duplicate requests reuse in-flight generation", async ({
    page,
    workerEnvironment,
  }) => {
    const { grantId } = await openNewTrial(page, workerEnvironment);
    await startConversion(page);
    await waitForAudiobook(page);
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    const articleResponse = await page.request.get(
      workerEnvironment.origin + "/api/audiobooks/" + id,
      { headers: await getTrialSessionHeaders(page) },
    );
    const article = audiobookSchema.parse(await articleResponse.json());
    if (article.status !== "ready") throw new Error("Article not prepared");
    const unitCount = article.narrationDocument.synchronizationUnits.length;
    expect(unitCount).toBeGreaterThan(1);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect
      .poll(async () => (await readSpeechCalls(workerEnvironment)).length)
      .toBe(unitCount);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const duplicate = await browserPost(
      page,
      workerEnvironment.origin + "/api/audiobooks/" + id + "/segments/0",
      { headers: mutationHeaders(), data: { retry: false } },
    );
    expect(duplicate.status()).toBe(200);
    expect((await readGrant(page, grantId)).duration.reservedMilliseconds).toBeGreaterThan(0);
    await fetch(workerEnvironment.origin + "/__qa/release-speech", { method: "POST" });
    await expect
      .poll(async () => (await readGrant(page, grantId)).duration.reservedMilliseconds)
      .toBe(0);
    expect(await readSpeechCalls(workerEnvironment)).toHaveLength(unitCount);
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  });
  test("seeking within in-flight speech synthesis lookahead prioritizes the destination without duplicate synthesis", async ({
    page,
    workerEnvironment,
  }) => {
    await openNewTrial(page, workerEnvironment);
    await startConversion(page);
    await waitForAudiobook(page);
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    const articleResponse = await page.request.get(
      workerEnvironment.origin + "/api/audiobooks/" + id,
      { headers: await getTrialSessionHeaders(page) },
    );
    const article = audiobookSchema.parse(await articleResponse.json());
    if (article.status !== "ready") throw new Error("Article not prepared");
    const unitCount = article.narrationDocument.synchronizationUnits.length;
    expect(unitCount).toBeGreaterThan(1);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect
      .poll(async () => (await readSpeechCalls(workerEnvironment)).length)
      .toBe(unitCount);
    await page.getByRole("combobox", { name: "Start at passage" }).selectOption("3");
    await expect
      .poll(async () => (await readSpeechCalls(workerEnvironment)).length)
      .toBe(unitCount);
    await fetch(workerEnvironment.origin + "/__qa/release-speech", { method: "POST" });
    await expect
      .poll(() => page.locator("audio").getAttribute("src"))
      .toContain("/segments/3/audio.mp3");
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("combobox", { name: "Start at passage" }).selectOption("1");
    expect(await readSpeechCalls(workerEnvironment)).toHaveLength(unitCount);
    await expect
      .poll(async () => {
        const result = await page.request.get(workerEnvironment.origin + "/api/audiobooks/" + id, {
          headers: await getTrialSessionHeaders(page),
        });
        const updatedArticle = audiobookSchema.parse(await result.json());
        if (updatedArticle.status !== "ready") throw new Error("Article not prepared");
        return updatedArticle.segments
          .map((segment) => segment.sequence)
          .sort((left, right) => left - right);
      })
      .toEqual(article.narrationDocument.synchronizationUnits.map((_, sequence) => sequence));
  });
  test("concurrent conversions share allowance and retain both segments after capped overruns", async ({
    page,
    workerEnvironment,
  }) => {
    const { grantId } = await openNewTrial(page, workerEnvironment);
    await setAllowance(workerEnvironment, grantId, 10_000);
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const response = await browserPost(
        page,
        workerEnvironment.origin + "/api/grants/" + grantId + "/conversions",
        {
          headers: { ...mutationHeaders(), "Idempotency-Key": crypto.randomUUID() },
          data: { sourceUrl: "https://source.example.test/fixture" },
        },
      );
      ids.push(startConversionResponseSchema.parse(await response.json()).conversion.conversionId);
    }
    for (const id of ids)
      await expect.poll(async () => (await readConversion(page, id)).status).toBe("ready");
    await Promise.all(
      ids.map((id) =>
        browserPost(page, workerEnvironment.origin + "/api/audiobooks/" + id + "/segments/0", {
          headers: mutationHeaders(),
          data: { retry: false },
        }),
      ),
    );
    await expect.poll(async () => (await readSpeechCalls(workerEnvironment)).length).toBe(2);
    expect((await readGrant(page, grantId)).duration.spentMilliseconds).toBe(0);
    await fetch(workerEnvironment.origin + "/__qa/release-speech", { method: "POST" });
    await expect
      .poll(async () => (await readGrant(page, grantId)).duration.reservedMilliseconds)
      .toBe(0);
    expect((await readGrant(page, grantId)).duration).toEqual({
      availableMilliseconds: 0,
      reservedMilliseconds: 0,
      spentMilliseconds: 10_000,
    });
    for (const id of ids)
      expect(
        audioSegmentSchema.parse(
          await (
            await page.request.get(
              workerEnvironment.origin + "/api/audiobooks/" + id + "/segments/0",
              { headers: await getTrialSessionHeaders(page) },
            )
          ).json(),
        ).status,
      ).toBe("ready");
    const response = await browserPost(
      page,
      workerEnvironment.origin + "/api/grants/" + grantId + "/conversions",
      {
        headers: { ...mutationHeaders(), "Idempotency-Key": crypto.randomUUID() },
        data: { sourceUrl: "https://source.example.test/fixture" },
      },
    );
    expect(response.status()).toBe(202);
  });
});
function mutationHeaders() {
  return { "Content-Type": "application/json", "X-Create-Audiobook-From-URL-Request": "1" };
}

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
