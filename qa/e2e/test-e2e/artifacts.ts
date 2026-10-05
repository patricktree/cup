import { expect } from "@playwright/test";

import { analyzeMp3 } from "@cup/audiobook-production";

export async function validateAudioSegment({ audioUrl }: { audioUrl: string }): Promise<void> {
  const audioResponse = await fetch(audioUrl);
  expect(audioResponse.status).toBe(200);
  expect(audioResponse.headers.get("Content-Type")).toBe("audio/mpeg");
  expect(audioResponse.headers.get("Accept-Ranges")).toBe("bytes");
  const audioEtag = audioResponse.headers.get("ETag");
  if (audioEtag === null) throw new Error("MP3 response did not include an ETag");
  const audio = new Uint8Array(await audioResponse.arrayBuffer());
  expect(Number(audioResponse.headers.get("Content-Length"))).toBe(audio.byteLength);
  expect(analyzeMp3(audio).durationMilliseconds).toBeGreaterThan(0);

  const audioHead = await fetch(audioUrl, { method: "HEAD" });
  expect(audioHead.status).toBe(200);
  expect(await audioHead.text()).toBe("");
  expect(Number(audioHead.headers.get("Content-Length"))).toBe(audio.byteLength);

  const audioRange = await fetch(audioUrl, { headers: { Range: "bytes=0-9" } });
  expect(audioRange.status).toBe(206);
  expect(audioRange.headers.get("Content-Range")).toBe(`bytes 0-9/${audio.byteLength}`);
  expect((await audioRange.arrayBuffer()).byteLength).toBe(10);

  const unchangedAudio = await fetch(audioUrl, { headers: { "If-None-Match": audioEtag } });
  expect(unchangedAudio.status).toBe(304);
}
