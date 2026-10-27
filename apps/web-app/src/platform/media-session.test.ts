import { expect, test } from "@playwright/test";

import type { publishMediaMetadata } from "#src/platform/media-session.ts";

test("only the media session's metadata is set, and clearing removes it", async ({
  mount,
  page,
}) => {
  await mount("routes/index/LandingPage");

  const result = await page.evaluate(async () => {
    const calls: string[] = [];
    const { mediaSession } = navigator;
    mediaSession.setActionHandler = (action) => calls.push(`setActionHandler:${action}`);
    mediaSession.setPositionState = () => calls.push("setPositionState");
    const modulePath = "/src/platform/media-session.ts";
    const module: { publishMediaMetadata: typeof publishMediaMetadata } = await import(modulePath);

    const clear = module.publishMediaMetadata({
      title: "A title",
      artworkUrl: "https://example.com/cover?token=fixture",
    });
    const published = {
      title: mediaSession.metadata?.title,
      artwork: mediaSession.metadata?.artwork.map((image) => image.src),
    };
    clear();
    const cleared = mediaSession.metadata;

    module.publishMediaMetadata({ title: "Without a cover", artworkUrl: undefined });
    const withoutCover = mediaSession.metadata?.artwork.length;

    return { calls, published, cleared, withoutCover };
  });

  expect(result).toEqual({
    calls: [],
    published: { title: "A title", artwork: ["https://example.com/cover?token=fixture"] },
    cleared: null,
    withoutCover: 0,
  });
});
