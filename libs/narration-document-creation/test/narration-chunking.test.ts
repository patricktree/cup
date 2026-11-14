import { expect, test } from "vitest";

import { createNarrationChunks } from "#src/narration-chunking.ts";

const MAX_CHUNK_CHARACTERS = 2_000;

test("creates one narration chunk per paragraph-like element", () => {
  const html = `
    <article>
      <h1>A Source Title</h1>
      <div class="introduction">
        <p>The first <em>paragraph</em>.</p>
        <p>The second paragraph.</p>
      </div>
      <h2>A list</h2>
      <ul>
        <li>First item</li>
        <li>Second <strong>item</strong></li>
      </ul>
    </article>
  `;

  expect(createNarrationChunks(html)).toMatchInlineSnapshot(`
    [
      {
        "text": "A Source Title

    The first paragraph.",
      },
      {
        "text": "The second paragraph.",
      },
      {
        "text": "A list

    First item",
      },
      {
        "text": "Second item",
      },
    ]
  `);
});

test("attaches consecutive non-empty headings to the next narration block", () => {
  const html = `
    <h1>First heading</h1>
    <h2> </h2>
    <h3>Second heading</h3>
    <p>Narration text.</p>
  `;

  expect(createNarrationChunks(html)).toEqual([
    { text: "First heading\n\nSecond heading\n\nNarration text." },
  ]);
});

test("splits only a paragraph that exceeds the narration chunk limit", () => {
  const paragraphText = Array.from({ length: 500 }, (_, index) => `word${index + 1}`).join(" ");
  const chunks = createNarrationChunks(`<p>${paragraphText}</p><p>A short paragraph.</p>`);

  expect(chunks.map(({ text }) => text.length)).toMatchInlineSnapshot(`
    [
      1995,
      1895,
      18,
    ]
  `);
  expect(chunks.every(({ text }) => text.length <= MAX_CHUNK_CHARACTERS)).toBe(true);
  expect(
    chunks
      .slice(0, -1)
      .map(({ text }) => text)
      .join(" "),
  ).toBe(paragraphText);
});

test("splits oversized narration blocks at sentence boundaries", () => {
  const firstSentence = `${"a".repeat(1_198)}.`;
  const secondSentence = `${"b".repeat(898)}.`;

  expect(createNarrationChunks(`<p>${firstSentence} ${secondSentence}</p>`)).toEqual([
    { text: firstSentence },
    { text: secondSentence },
  ]);
});

test("splits oversized narration blocks between Japanese sentences without whitespace", () => {
  const firstSentence = `${"甲".repeat(1_199)}。`;
  const secondSentence = `${"乙".repeat(899)}。`;

  expect(createNarrationChunks(`<p>${firstSentence}${secondSentence}</p>`)).toEqual([
    { text: firstSentence },
    { text: secondSentence },
  ]);
});

test("does not add whitespace between adjacent Japanese sentences", () => {
  const firstSentence = `${"甲".repeat(499)}。`;
  const secondSentence = `${"乙".repeat(499)}。`;
  const thirdSentence = `${"丙".repeat(1_199)}。`;

  expect(createNarrationChunks(`<p>${firstSentence}${secondSentence}${thirdSentence}</p>`)).toEqual(
    [{ text: `${firstSentence}${secondSentence}` }, { text: thirdSentence }],
  );
});

test("recognizes question and exclamation marks as sentence boundaries", () => {
  for (const [firstPunctuation, secondPunctuation] of [
    ["?", "!"],
    ["？", "！"],
  ]) {
    const firstSentence = `${"a".repeat(1_198)}${firstPunctuation}`;
    const secondSentence = `${"b".repeat(898)}${secondPunctuation}`;
    const sentenceSeparator = firstPunctuation === "?" ? " " : "";

    expect(
      createNarrationChunks(`<p>${firstSentence}${sentenceSeparator}${secondSentence}</p>`),
    ).toEqual([{ text: firstSentence }, { text: secondSentence }]);
  }
});

test("preserves the pause after a heading when its narration block is split", () => {
  const paragraphText = "narration ".repeat(250).trim();
  const chunks = createNarrationChunks(`<h2>A heading</h2><p>${paragraphText}</p>`);

  expect(chunks[0]?.text.startsWith("A heading\n\n")).toBe(true);
});

test("keeps narration text at the exact chunk limit together", () => {
  const narrationText = "a".repeat(MAX_CHUNK_CHARACTERS);

  expect(createNarrationChunks(`<p>${narrationText}</p>`)).toEqual([{ text: narrationText }]);
});

test("splits unbroken narration text without separating an emoji surrogate pair", () => {
  const firstChunkText = "a".repeat(MAX_CHUNK_CHARACTERS - 1);

  expect(createNarrationChunks(`<p>${firstChunkText}😀</p>`)).toEqual([
    { text: firstChunkText },
    { text: "😀" },
  ]);
});

test("retains words surrounding oversized unbroken narration text", () => {
  const oversizedWord = "a".repeat(MAX_CHUNK_CHARACTERS + 1);

  expect(createNarrationChunks(`<p>Before ${oversizedWord} after.</p>`)).toEqual([
    { text: "Before" },
    { text: "a".repeat(MAX_CHUNK_CHARACTERS) },
    { text: "a after." },
  ]);
});

test("preserves visible text from generic containers", () => {
  const html = `
    <div>This unwrapped container text is not a paragraph.</div>
    <p>
      Text with&nbsp;spacing and <em>inline markup</em>.<br>
      A new line.
      <script>This must not be narrated.</script>
    </p>
    <ul>
      <li><p>A paragraph inside a list item.</p></li>
      <li>
        A parent list item.
        <ul><li>A nested list item.</li></ul>
      </li>
    </ul>
    <h2>A final heading</h2>
  `;

  expect(createNarrationChunks(html)).toMatchInlineSnapshot(`
    [
      {
        "text": "This unwrapped container text is not a paragraph.",
      },
      {
        "text": "Text with spacing and inline markup.
    A new line.",
      },
      {
        "text": "A paragraph inside a list item.",
      },
      {
        "text": "A parent list item.",
      },
      {
        "text": "A nested list item.",
      },
      {
        "text": "A final heading",
      },
    ]
  `);
});

test("preserves line breaks between direct container text", () => {
  const html = `<div>Text before.<br><!-- not visible -->Text after.</div>`;

  expect(createNarrationChunks(html)).toEqual([{ text: "Text before.\nText after." }]);
});

test("returns no narration chunks when the source material has no visible text", () => {
  const html = `
    <!-- not visible -->
    <script>script text</script>
    <style>style text</style>
    <svg><text>SVG text</text></svg>
    <template><p>template text</p></template>
  `;

  expect(createNarrationChunks(html)).toEqual([]);
});

test("collapses presentation whitespace in HTML text", () => {
  const html = "<p> First\tsecond\fthird\r\nfourth\n\n fifth </p>";

  expect(createNarrationChunks(html)).toEqual([{ text: "First second third fourth fifth" }]);
});

test("preserves text surrounding nested block elements", () => {
  const html = `
    <div>
      Text before a nested container.
      <div>Text in the nested container.</div>
      Text before an explicit paragraph.
      <p>Text in the explicit paragraph.</p>
      Text after the explicit paragraph.
    </div>
    Text directly in the document fragment.
    <custom-content>Text in a custom element.</custom-content>
  `;

  expect(createNarrationChunks(html)).toMatchInlineSnapshot(`
    [
      {
        "text": "Text before a nested container.",
      },
      {
        "text": "Text in the nested container.",
      },
      {
        "text": "Text before an explicit paragraph.",
      },
      {
        "text": "Text in the explicit paragraph.",
      },
      {
        "text": "Text after the explicit paragraph.",
      },
      {
        "text": "Text directly in the document fragment.",
      },
      {
        "text": "Text in a custom element.",
      },
    ]
  `);
});

test("collapses HTML text-node whitespace without losing explicit breaks", () => {
  const compactHtml = "<div>Before <em>inline text</em>.<br>After.</div>";
  const formattedHtml = `<div>
    Before
    <em>inline
    text</em>.<br>
    After.
  </div>`;

  expect(createNarrationChunks(formattedHtml)).toEqual(createNarrationChunks(compactHtml));
  expect(createNarrationChunks(formattedHtml)).toEqual([{ text: "Before inline text.\nAfter." }]);
});
