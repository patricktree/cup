import { expect, type Page } from "@playwright/test";

import { analyzeMp3 } from "@cup/audiobook-production";

import { getTrialSessionHeaders } from "#test-e2e/journey.ts";

/**
 * Follows the audiobook's cover image pointer, a signed media URL, and checks what the delivery
 * route serves to it alone. Returns the route's URL without the token.
 */
export async function validateCoverImage({
  conversionId,
  origin,
  page,
}: {
  conversionId: string;
  origin: string;
  page: Page;
}): Promise<string> {
  const request = page.request;
  const headers = await getTrialSessionHeaders(page);
  const audiobook: unknown = await (
    await request.get(`${origin}/api/audiobooks/${conversionId}`, { headers })
  ).json();
  const coverImageUrl = `${origin}/api/files/audiobooks/${conversionId}/cover-image`;
  expect(audiobook).toMatchObject({
    coverImage: {
      url: expect.stringMatching(new RegExp(`^${coverImageUrl}\\?token=`)),
      alternativeText: "A deterministic cover image",
    },
  });
  const signedCoverImageUrl = getCoverImageUrl(audiobook);

  // No session headers: the signed media URL authorizes the request by itself.
  const imageResponse = await request.get(signedCoverImageUrl);
  expect(imageResponse.status()).toBe(200);
  expect(imageResponse.headers()["content-type"]).toBe("image/png");
  const image = await imageResponse.body();
  // The PNG signature: the stored bytes are the publisher's original, not a re-encoding.
  expect([...image.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(Number(imageResponse.headers()["content-length"])).toBe(image.byteLength);

  const imageEtag = imageResponse.headers()["etag"];
  if (imageEtag === undefined) {
    throw new Error("Cover image response did not include an ETag");
  }
  const unchangedImage = await request.get(signedCoverImageUrl, {
    headers: { "If-None-Match": imageEtag },
  });
  expect(unchangedImage.status()).toBe(304);

  return coverImageUrl;
}

function getCoverImageUrl(audiobook: unknown): string {
  if (
    typeof audiobook !== "object" ||
    audiobook === null ||
    !("coverImage" in audiobook) ||
    typeof audiobook.coverImage !== "object" ||
    audiobook.coverImage === null ||
    !("url" in audiobook.coverImage) ||
    typeof audiobook.coverImage.url !== "string"
  ) {
    throw new Error("The audiobook response has no cover image URL");
  }
  return audiobook.coverImage.url;
}

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
  if (audioEtag === undefined) {
    throw new Error("MP3 response did not include an ETag");
  }
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
