import { expect, test } from "vitest";

import { createFakeNarrationContentSelector } from "#src/narration-content-selection.fake.ts";

test("selects annotated content with deterministic provider usage", async () => {
  const selectNarrationContent = createFakeNarrationContentSelector();

  await expect(
    selectNarrationContent("<article><h1>Fixture title</h1><p>Fixture body.</p></article>"),
  ).resolves.toEqual({
    selectedSourceMaterialHtml: "<article><h1>Fixture title</h1><p>Fixture body.</p></article>",
    chunkCount: 1,
    usage: {
      provider: "fake",
      model: "deterministic-element-selection",
      requestCount: 1,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd: 0,
    },
  });
});

test("surfaces a configured provider failure", async () => {
  const selectNarrationContent = createFakeNarrationContentSelector({
    failure: new Error("Configured selection failure"),
  });

  await expect(selectNarrationContent("<p>Fixture body.</p>")).rejects.toThrow(
    "Configured selection failure",
  );
});
