import { expect, type Page } from "@playwright/test";

import { analyzeMp3 } from "@cup/audiobook-production";

import { getTrialSessionHeaders } from "#test-e2e/journey.ts";

export async function validateAudioSegment({
  audioUrl,
  page,
}: {
  audioUrl: string;
  page: Page;
}): Promise<void> {
  const request = page.request;
  const headers = await getTrialSessionHeaders(page);
  const audioResponse = await request.get(audioUrl, { headers });
  expect(audioResponse.status()).toBe(200);
  expect(audioResponse.headers()["content-type"]).toBe("audio/mpeg");
  expect(audioResponse.headers()["accept-ranges"]).toBe("bytes");
  const audioEtag = audioResponse.headers()["etag"];
  if (audioEtag === undefined) throw new Error("MP3 response did not include an ETag");
  const audio = new Uint8Array(await audioResponse.body());
  expect(Number(audioResponse.headers()["content-length"])).toBe(audio.byteLength);
  expect(analyzeMp3(audio).durationMilliseconds).toBeGreaterThan(0);

  const audioHead = await request.head(audioUrl, { headers });
  expect(audioHead.status()).toBe(200);
  expect(await audioHead.text()).toBe("");
  expect(Number(audioHead.headers()["content-length"])).toBe(audio.byteLength);

  const audioRange = await request.get(audioUrl, { headers: { ...headers, Range: "bytes=0-9" } });
  expect(audioRange.status()).toBe(206);
  expect(audioRange.headers()["content-range"]).toBe(`bytes 0-9/${audio.byteLength}`);
  expect((await audioRange.body()).byteLength).toBe(10);

  const unchangedAudio = await request.get(audioUrl, {
    headers: { ...headers, "If-None-Match": audioEtag },
  });
  expect(unchangedAudio.status()).toBe(304);
}
