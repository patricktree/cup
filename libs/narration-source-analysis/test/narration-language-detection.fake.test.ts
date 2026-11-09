import { expect, test } from "vitest";

import { createFakeNarrationLanguageDetector } from "@cup/narration-source-analysis/fake";

const INPUT = {
  sourceTitle: "Fixture title",
  sourceMaterialHtml: "<p>Fixture body.</p>",
  declaredLanguage: { htmlLang: "de-AT" },
};

test("answers the configured language subtag", async () => {
  const detect = createFakeNarrationLanguageDetector({ answer: "de" });

  await expect(detect(INPUT)).resolves.toEqual({ narrationLanguage: "de-AT" });
});

test("can answer nothing", async () => {
  const detect = createFakeNarrationLanguageDetector({ answer: null });

  await expect(detect(INPUT)).resolves.toEqual({
    narrationLanguage: "de-AT",
    fallbackReason: "no-answer",
  });
});

test("can fail on every attempt", async () => {
  const detect = createFakeNarrationLanguageDetector({
    failure: new Error("Configured detection failure"),
  });
  const attempts: unknown[] = [];

  await expect(
    detect(INPUT, {
      runDetection: async (detectLanguage) => {
        try {
          return await detectLanguage();
        } catch (error) {
          attempts.push(error);
          throw error;
        }
      },
    }),
  ).resolves.toEqual({
    narrationLanguage: "de-AT",
    fallbackReason: "detector-error",
    detectorError: new Error("Configured detection failure"),
  });
  expect(attempts).toEqual([new Error("Configured detection failure")]);
});
