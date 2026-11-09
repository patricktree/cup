import { expect, test } from "vitest";

import type { DeclaredLanguage } from "@cup/prepare-source-material";

import type { Completion, CompletionResponse } from "#src/completion.ts";
import { createNarrationLanguageDetector } from "#src/narration-language-detection.ts";
import { PRODUCTION_DETECTION_CONFIG } from "#src/production-narration-language-detection.ts";

test.each([
  ["de", { htmlLang: "de-AT" }, "de-AT"],
  ["en", { htmlLang: "de-DE" }, "en"],
  ["de", {}, "de"],
  ["de", { htmlLang: "de" }, "de"],
] as const)(
  "answer %s with declared language %j gives narration language %s",
  async (answer, declaredLanguage, narrationLanguage) => {
    const detect = createDetector(answerWith(answer));

    await expect(detect(input(declaredLanguage))).resolves.toEqual({ narrationLanguage });
  },
);

test("canonicalizes the answer and the declared region", async () => {
  const detect = createDetector(answerWith("DE"));

  await expect(detect(input({ htmlLang: "de-at" }))).resolves.toEqual({
    narrationLanguage: "de-AT",
  });
});

test("takes the region from <html lang> over og:locale", async () => {
  const detect = createDetector(answerWith("de"));

  await expect(detect(input({ htmlLang: "de-DE", ogLocale: "de_AT" }))).resolves.toEqual({
    narrationLanguage: "de-DE",
  });
});

test("takes the region from og:locale in its underscore form when <html lang> is invalid", async () => {
  const detect = createDetector(answerWith("de"));

  await expect(detect(input({ htmlLang: "not a tag", ogLocale: "de_AT" }))).resolves.toEqual({
    narrationLanguage: "de-AT",
  });
});

test("falls back to the declared language with the detector's error when the detector fails", async () => {
  const error = new Error("Gemini unavailable");
  const detect = createDetector(async () => {
    throw error;
  });

  await expect(detect(input({ htmlLang: "de-at" }))).resolves.toEqual({
    narrationLanguage: "de-AT",
    fallbackReason: "detector-error",
    detectorError: error,
  });
});

test.each([
  ["calls no tool", async () => response({ stopReason: "length" }), "no-answer"],
  ["answers an empty subtag", answerWith(""), "no-answer"],
  ["answers malformed arguments", answerWith(42), "no-answer"],
  ["answers an invalid tag", answerWith("not a tag"), "invalid-tag"],
  ["answers the undetermined language", answerWith("und"), "invalid-tag"],
  ["answers a language name in English", answerWith("German"), "invalid-tag"],
  ["answers a language name in the language itself", answerWith("Deutsch"), "invalid-tag"],
  ["answers a subtag that names no language", answerWith("xx"), "invalid-tag"],
  ["answers no linguistic content", answerWith("zxx"), "invalid-tag"],
] as const satisfies ReadonlyArray<readonly [string, Completion, string]>)(
  "falls back to the declared language when the detector %s",
  async (_description, completion, fallbackReason) => {
    const detect = createDetector(completion);

    await expect(detect(input({ htmlLang: "de-at", ogLocale: "en_US" }))).resolves.toEqual({
      narrationLanguage: "de-AT",
      fallbackReason,
    });
  },
);

test.each([
  [{ ogLocale: "de_AT" }, "de-AT"],
  [{ htmlLang: "", ogLocale: "fr_FR" }, "fr-FR"],
  [{ htmlLang: "und", ogLocale: "fr" }, "fr"],
  [{ htmlLang: "german", ogLocale: "de_AT" }, "de-AT"],
] as const)(
  "falls back to a valid og:locale when <html lang> is missing or invalid (%j)",
  async (declaredLanguage, narrationLanguage) => {
    const detect = createDetector(answerWith("not a tag"));

    await expect(detect(input(declaredLanguage))).resolves.toEqual({
      narrationLanguage,
      fallbackReason: "invalid-tag",
    });
  },
);

test.each([{}, { htmlLang: "not a tag", ogLocale: "_" }])(
  "has no narration language when the detector fails and the declared language %j is unusable",
  async (declaredLanguage) => {
    const detect = createDetector(async () => {
      throw new Error("Gemini unavailable");
    });

    await expect(detect(input(declaredLanguage))).resolves.toEqual({
      fallbackReason: "detector-error",
      detectorError: new Error("Gemini unavailable"),
    });
  },
);

test("ignores an invalid declared language when the answer is valid", async () => {
  const detect = createDetector(answerWith("de"));

  await expect(detect(input({ htmlLang: "not a tag" }))).resolves.toEqual({
    narrationLanguage: "de",
  });
});

test("keeps only the language subtag of an answer that names a region", async () => {
  const detect = createDetector(answerWith("de-CH"));

  await expect(detect(input({ htmlLang: "en-US" }))).resolves.toEqual({
    narrationLanguage: "de",
  });
});

test("asks with the source title, the declared language and the start of the text without HTML", async () => {
  const requests: Parameters<Completion>[] = [];
  const detect = createDetector(async (...request) => {
    requests.push(request);
    return answerWith("de")(...request);
  });
  const paragraph = `<p>Ein <em>kurzer</em> Absatz.</p><script>ignored()</script>`;

  await detect(
    {
      sourceTitle: "Kickls Aussagen im Faktencheck",
      sourceMaterialHtml: paragraph.repeat(1_000),
      declaredLanguage: { htmlLang: "de-AT" },
    },
    { conversionId: "conversion-1" },
  );

  expect(requests).toHaveLength(1);
  const [request, options] = requests[0]!;
  expect(request.userPrompt).toContain("Kickls Aussagen im Faktencheck");
  expect(request.userPrompt).toContain("<html lang>: de-AT\nog:locale: (not declared)");
  const text = /<narrated-text>\n(.*)\n<\/narrated-text>/su.exec(request.userPrompt)?.[1];
  expect(text?.startsWith("Ein kurzer Absatz. Ein kurzer Absatz.")).toBe(true);
  expect(text).not.toContain("<");
  expect(text).not.toContain("ignored");
  expect(text).toHaveLength(8_000);
  expect(request.systemPrompt).toContain("majority of the narrated text");
  expect(options).toMatchObject({
    reasoningEffort: "low",
    maxRetries: 0,
    gatewayMetadata: { conversionId: "conversion-1", stage: "narration-language-detection" },
  });
});

test("runs the detector call through the supplied runner and falls back when it rejects", async () => {
  const runs: unknown[] = [];
  const detect = createDetector(answerWith("de"));

  await expect(
    detect(input({ htmlLang: "de-AT" }), {
      runDetection: async (detectLanguage) => {
        runs.push(await detectLanguage());
        throw new Error("Step retries exhausted");
      },
    }),
  ).resolves.toEqual({
    narrationLanguage: "de-AT",
    fallbackReason: "detector-error",
    detectorError: new Error("Step retries exhausted"),
  });
  expect(runs).toEqual([{ language: "de" }]);
});

function createDetector(completion: Completion) {
  return createNarrationLanguageDetector({ ...PRODUCTION_DETECTION_CONFIG, completion });
}

function input(declaredLanguage: DeclaredLanguage = {}) {
  return {
    sourceTitle: "Kickls Aussagen im Faktencheck",
    sourceMaterialHtml: "<p>Gerald John, Alicia Prager, Sandra Schieder</p>",
    declaredLanguage,
  };
}

function answerWith(language: unknown): Completion {
  return async () =>
    response({
      toolCalls: [{ id: "call-1", name: "report_narration_language", arguments: { language } }],
      stopReason: "toolUse",
    });
}

function response(overrides: Partial<CompletionResponse>): CompletionResponse {
  return {
    provider: "faux",
    model: "faux-model",
    toolCalls: [],
    stopReason: "stop",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    ...overrides,
  };
}
