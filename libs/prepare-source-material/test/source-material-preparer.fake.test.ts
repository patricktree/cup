import { expect, test } from "vitest";

import { createControlledSourceMaterialPreparer } from "#src/source-material-preparer.fake.ts";

const CONTROLLED_URL = "https://source.example.test/fixture";

test("prepares controlled HTML with production cleanup, its first headline as the source title, and the cut", async () => {
  const prepareSourceMaterial = createControlledSourceMaterialPreparer({
    url: CONTROLLED_URL,
    html: `
      <nav>Site navigation</nav>
      <main>
        <h1> A controlled source </h1>
        <p>Useful narration content.</p>
        <script>throw new Error("must not run")</script>
      </main>
      <footer>Site footer</footer>
    `,
  });

  await expect(prepareSourceMaterial(CONTROLLED_URL)).resolves.toEqual({
    title: "A controlled source",
    html: expect.stringContaining("<p>Useful narration content.</p>"),
  });

  const { html } = await prepareSourceMaterial(CONTROLLED_URL);
  expect(html).not.toContain("<h1");
  expect(html).not.toContain("<nav");
  expect(html).not.toContain("<script");
  expect(html).not.toContain("<footer");
});

test("rejects a source URL other than the controlled fixture URL", async () => {
  const prepareSourceMaterial = createControlledSourceMaterialPreparer({
    url: CONTROLLED_URL,
    html: "<h1>Fixture</h1>",
  });

  await expect(prepareSourceMaterial("https://different.example.test/source")).rejects.toThrow(
    "Unexpected controlled source URL",
  );
});
