import { expect, test } from "vitest";

import {
  SOURCE_ELEMENT_ID_ATTRIBUTE,
  annotateSourceElements,
  filterSourceByElementIds,
  type SourceElementIds,
} from "#src/source-element-selection.ts";

test("annotates every element with an ID in document order", async () => {
  const annotatedSourceMaterial = await annotateSourceElements(
    '<article><h1>Title</h1><p>Hello<br>world<img src="/cover.jpg"></p></article>',
  );

  expect(annotatedSourceMaterial).toEqual({
    html: `<article ${SOURCE_ELEMENT_ID_ATTRIBUTE}="0"><h1 ${SOURCE_ELEMENT_ID_ATTRIBUTE}="1">Title</h1><p ${SOURCE_ELEMENT_ID_ATTRIBUTE}="2">Hello<br ${SOURCE_ELEMENT_ID_ATTRIBUTE}="3">world<img src="/cover.jpg" ${SOURCE_ELEMENT_ID_ATTRIBUTE}="4"></p></article>`,
    elementIds: ["0", "1", "2", "3", "4"],
  });
});

test("replaces an existing element identifier", async () => {
  const annotatedSourceMaterial = await annotateSourceElements(
    `<p ${SOURCE_ELEMENT_ID_ATTRIBUTE}="existing">Text</p>`,
  );

  expect(annotatedSourceMaterial).toEqual({
    html: `<p ${SOURCE_ELEMENT_ID_ATTRIBUTE}="0">Text</p>`,
    elementIds: ["0"],
  });
});

test("keeps selected elements, their descendants, and their ancestor structure", async () => {
  const annotatedSourceMaterial = await annotateSourceElements(
    "<main>outside<!--context--><article><p>before<em>selected <strong>text</strong></em>after</p><aside>omit</aside></article></main>",
  );

  const selectedAnnotatedSourceMaterialHtml = await filterSourceByElementIds({
    annotatedSourceMaterial,
    selectedElementIds: createSourceElementIds("3"),
  });

  expect(selectedAnnotatedSourceMaterialHtml).toBe(
    `<main ${SOURCE_ELEMENT_ID_ATTRIBUTE}="0"><!--context--><article ${SOURCE_ELEMENT_ID_ATTRIBUTE}="1"><p ${SOURCE_ELEMENT_ID_ATTRIBUTE}="2"><em ${SOURCE_ELEMENT_ID_ATTRIBUTE}="3">selected <strong ${SOURCE_ELEMENT_ID_ATTRIBUTE}="4">text</strong></em></p></article></main>`,
  );
});

test("annotates and selects elements inside templates", async () => {
  const annotatedSourceMaterial = await annotateSourceElements(
    "<template>outside<p>selected</p></template>",
  );

  const selectedAnnotatedSourceMaterialHtml = await filterSourceByElementIds({
    annotatedSourceMaterial,
    selectedElementIds: createSourceElementIds("1"),
  });

  expect(selectedAnnotatedSourceMaterialHtml).toBe(
    `<template ${SOURCE_ELEMENT_ID_ATTRIBUTE}="0"><p ${SOURCE_ELEMENT_ID_ATTRIBUTE}="1">selected</p></template>`,
  );
});

test("keeps a selected void element without surrounding text or siblings", async () => {
  const annotatedSourceMaterial = await annotateSourceElements(
    '<figure>before<img src="/cover.jpg"><figcaption>omit</figcaption>after</figure>',
  );

  const selectedAnnotatedSourceMaterialHtml = await filterSourceByElementIds({
    annotatedSourceMaterial,
    selectedElementIds: createSourceElementIds("1"),
  });

  expect(selectedAnnotatedSourceMaterialHtml).toBe(
    `<figure ${SOURCE_ELEMENT_ID_ATTRIBUTE}="0"><img src="/cover.jpg" ${SOURCE_ELEMENT_ID_ATTRIBUTE}="1"></figure>`,
  );
});

test("rejects source material containing an unidentified element", async () => {
  await expect(
    filterSourceByElementIds({
      annotatedSourceMaterial: { html: "<p>Unidentified</p>", elementIds: [] },
      selectedElementIds: createSourceElementIds(),
    }),
  ).rejects.toThrow(
    `Expected every HTML element to have a ${SOURCE_ELEMENT_ID_ATTRIBUTE} attribute`,
  );
});

function createSourceElementIds(...elementIds: string[]): SourceElementIds {
  if (!areSourceElementIds(elementIds)) {
    throw new Error("Narration source element IDs must be numeric");
  }

  return elementIds;
}

function areSourceElementIds(elementIds: readonly string[]): elementIds is SourceElementIds {
  return elementIds.every((elementId) => /^\d+$/.test(elementId));
}
