import { parseFragment } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import { z } from "zod";

import { createNarrationChunks } from "#src/narration-chunking.ts";

const EXCLUDED_TAG_NAMES = new Set([
  "audio",
  "canvas",
  "embed",
  "iframe",
  "img",
  "noscript",
  "object",
  "picture",
  "script",
  "source",
  "style",
  "svg",
  "template",
  "track",
  "video",
]);

const HEADING_TAG_NAMES = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

const STRUCTURAL_TAG_NAMES = new Set(["blockquote", "li", "ol", "p", "ul"]);

const INLINE_TAG_NAMES = new Set(["a", "br", "code", "em", "strong"]);

const FLATTENED_INLINE_TAG_NAMES = new Set([
  "abbr",
  "b",
  "bdi",
  "bdo",
  "cite",
  "data",
  "del",
  "dfn",
  "i",
  "ins",
  "kbd",
  "label",
  "mark",
  "q",
  "ruby",
  "s",
  "samp",
  "small",
  "span",
  "sub",
  "sup",
  "time",
  "u",
  "var",
  "wbr",
]);

const NARRATION_ELEMENT_SEPARATOR = "\n\n";

/** Runtime schema for one independently addressable narration unit. */
export const SYNCHRONIZATION_UNIT_SCHEMA = z
  .object({
    id: z.string().min(1),
    narrationText: z.string().min(1),
  })
  .strict();

/** One independently addressable piece of displayed and spoken narration. */
export type SynchronizationUnit = z.infer<typeof SYNCHRONIZATION_UNIT_SCHEMA>;

/** Safe structured text and ordered units used to produce synchronized outputs. */
export type NarrationDocument = {
  html: string;
  synchronizationUnits: readonly SynchronizationUnit[];
};

/** Supplies the source title and selected HTML used to build a narration document. */
export type CreateOptions = {
  sourceTitle: string;
  sourceMaterialHtml: string;
};

type SafeText = { type: "text"; value: string };
type SafeBoundary = { type: "boundary"; children: readonly SafeNode[] };
type SafeElement = {
  type: "element";
  tagName: string;
  attributes: readonly SafeAttribute[];
  children: readonly SafeNode[];
  sourceKey?: number;
};
type SafeNode = SafeBoundary | SafeElement | SafeText;
type SafeAttribute = { name: string; value: string };
type RenderedUnit = { html: string; wrappers: readonly SafeElement[] };

/** Creates safe display HTML and matching paragraph-oriented synchronization units. */
export function createNarrationDocument({
  sourceTitle,
  sourceMaterialHtml,
}: CreateOptions): NarrationDocument {
  const normalizedSourceTitle = normalizeNarrationText(sourceTitle);
  const comparableSourceTitle = normalizeComparableNarrationText(sourceTitle);

  if (normalizedSourceTitle.length === 0) {
    throw new Error("Expected the source title to contain narration text");
  }

  const safeNodes = sanitizeChildren(parseFragment(sourceMaterialHtml), {
    nextSourceKey: 0,
  });
  const synchronizationUnits: SynchronizationUnit[] = [];
  const renderedUnits: RenderedUnit[] = [];
  const pendingHeadings: SafeElement[] = [];
  let hasSkippedEquivalentSourceHeading = false;

  function addSynchronizationUnit(
    narrationText: string,
    html: string,
    wrappers: readonly SafeElement[] = [],
  ): void {
    const id = createSynchronizationUnitId(synchronizationUnits.length);

    synchronizationUnits.push({ id, narrationText });
    renderedUnits.push({
      html: html.replace("{{SYNCHRONIZATION_UNIT_ID}}", id),
      wrappers,
    });
  }

  function addNarrationBlock(element: SafeElement, wrappers: readonly SafeElement[]): void {
    const normalizedElement = normalizeSafeElement(element);
    const blockHtml = serializeSafeNode(normalizedElement);
    const headingsHtml = pendingHeadings.map(serializeSafeNode).join("");
    const chunkTexts = createNarrationChunks(`${headingsHtml}${blockHtml}`).map(({ text }) => text);

    if (chunkTexts.length === 0) {
      return;
    }

    if (chunkTexts.length === 1) {
      const html =
        pendingHeadings.length === 0
          ? serializeSafeElement(normalizedElement, [
              { name: "id", value: "{{SYNCHRONIZATION_UNIT_ID}}" },
            ])
          : `<section id="{{SYNCHRONIZATION_UNIT_ID}}">${headingsHtml}${blockHtml}</section>`;

      addSynchronizationUnit(chunkTexts[0]!, html, wrappers);
      pendingHeadings.length = 0;
      return;
    }

    const narrationElements = [...pendingHeadings, normalizedElement];
    const narrationElementTexts = narrationElements.map((narrationElement) =>
      normalizeNarrationText(extractSafeText(narrationElement.children)),
    );
    const combinedNarrationText = narrationElementTexts.join(NARRATION_ELEMENT_SEPARATOR);
    let chunkSearchStart = 0;

    pendingHeadings.length = 0;

    for (const chunkText of chunkTexts) {
      const chunkStart = combinedNarrationText.indexOf(chunkText, chunkSearchStart);

      if (chunkStart < 0) {
        throw new Error("Expected every narration chunk to occur in its source block");
      }

      const chunkEnd = chunkStart + chunkText.length;
      const elementSlices = sliceNarrationElements({
        chunkEnd,
        chunkStart,
        narrationElements,
        narrationElementTexts,
      });
      const html =
        elementSlices.length === 1
          ? serializeSafeElement(elementSlices[0]!, [
              { name: "id", value: "{{SYNCHRONIZATION_UNIT_ID}}" },
            ])
          : `<section id="{{SYNCHRONIZATION_UNIT_ID}}">${elementSlices.map((elementSlice) => serializeSafeElement(elementSlice)).join("")}</section>`;

      addSynchronizationUnit(chunkText, html, wrappers);
      chunkSearchStart = chunkEnd;
    }
  }

  function visitNodes(nodes: readonly SafeNode[], wrappers: readonly SafeElement[] = []): void {
    let directContent: SafeNode[] = [];

    function flushDirectContent(): void {
      if (normalizeNarrationText(extractSafeText(directContent)).length > 0) {
        addNarrationBlock(
          {
            type: "element",
            tagName: "p",
            attributes: [],
            children: directContent,
          },
          wrappers,
        );
      }

      directContent = [];
    }

    for (const node of nodes) {
      if (node.type === "text") {
        directContent.push(node);
        continue;
      }

      if (node.type === "boundary") {
        flushDirectContent();
        visitNodes(node.children, wrappers);
        continue;
      }

      if (INLINE_TAG_NAMES.has(node.tagName)) {
        directContent.push(node);
        continue;
      }

      if (HEADING_TAG_NAMES.has(node.tagName)) {
        flushDirectContent();

        const normalizedHeading = normalizeSafeElement(node);
        const headingText = normalizeNarrationText(extractSafeText(normalizedHeading.children));

        if (headingText.length === 0) {
          continue;
        }

        if (
          !hasSkippedEquivalentSourceHeading &&
          normalizeComparableNarrationText(headingText) === comparableSourceTitle
        ) {
          hasSkippedEquivalentSourceHeading = true;
          continue;
        }

        pendingHeadings.push(normalizedHeading);
        continue;
      }

      if (node.tagName === "p") {
        flushDirectContent();
        addNarrationBlock(node, wrappers);
        continue;
      }

      flushDirectContent();
      visitNodes(node.children, [...wrappers, { ...node, children: [] }]);
    }

    flushDirectContent();
  }

  addSynchronizationUnit(
    normalizedSourceTitle,
    `<h1 id="{{SYNCHRONIZATION_UNIT_ID}}">${serializeNarrationText(normalizedSourceTitle)}</h1>`,
  );
  visitNodes(safeNodes);

  if (pendingHeadings.length > 0) {
    const headingsHtml = pendingHeadings.map(serializeSafeNode).join("");
    const chunkTexts = createNarrationChunks(headingsHtml).map(({ text }) => text);

    if (chunkTexts.length === 1) {
      const html =
        pendingHeadings.length === 1
          ? serializeSafeElement(pendingHeadings[0]!, [
              { name: "id", value: "{{SYNCHRONIZATION_UNIT_ID}}" },
            ])
          : `<section id="{{SYNCHRONIZATION_UNIT_ID}}">${headingsHtml}</section>`;

      addSynchronizationUnit(chunkTexts[0]!, html);
      pendingHeadings.length = 0;
    } else {
      for (const chunkText of chunkTexts) {
        addSynchronizationUnit(
          chunkText,
          `<p id="{{SYNCHRONIZATION_UNIT_ID}}">${serializeNarrationText(chunkText)}</p>`,
        );
      }
    }
  }

  return {
    html: `<article>${serializeRenderedUnits(renderedUnits)}</article>`,
    synchronizationUnits,
  };
}

function sliceNarrationElements({
  chunkEnd,
  chunkStart,
  narrationElements,
  narrationElementTexts,
}: {
  chunkEnd: number;
  chunkStart: number;
  narrationElements: readonly SafeElement[];
  narrationElementTexts: readonly string[];
}): SafeElement[] {
  const elementSlices: SafeElement[] = [];
  let elementStart = 0;

  for (const [elementIndex, element] of narrationElements.entries()) {
    const elementText = narrationElementTexts[elementIndex]!;
    const elementEnd = elementStart + elementText.length;
    const overlapStart = Math.max(chunkStart, elementStart);
    const overlapEnd = Math.min(chunkEnd, elementEnd);

    if (overlapStart < overlapEnd) {
      elementSlices.push({
        ...element,
        children: sliceSafeNodes(
          element.children,
          overlapStart - elementStart,
          overlapEnd - elementStart,
        ),
      });
    }

    elementStart = elementEnd + NARRATION_ELEMENT_SEPARATOR.length;
  }

  return elementSlices;
}

function sliceSafeNodes(
  nodes: readonly SafeNode[],
  rangeStart: number,
  rangeEnd: number,
): SafeNode[] {
  const slicedNodes: SafeNode[] = [];
  let nodeStart = 0;

  for (const node of nodes) {
    const nodeText = extractSafeText([node]);
    const nodeEnd = nodeStart + nodeText.length;
    const overlapStart = Math.max(rangeStart, nodeStart);
    const overlapEnd = Math.min(rangeEnd, nodeEnd);

    if (overlapStart < overlapEnd) {
      const localStart = overlapStart - nodeStart;
      const localEnd = overlapEnd - nodeStart;

      if (node.type === "text") {
        slicedNodes.push({ type: "text", value: node.value.slice(localStart, localEnd) });
      } else if (node.type === "element" && node.tagName === "br") {
        slicedNodes.push(node);
      } else {
        slicedNodes.push({
          ...node,
          children: sliceSafeNodes(node.children, localStart, localEnd),
        });
      }
    }

    nodeStart = nodeEnd;
  }

  return slicedNodes;
}

function createSynchronizationUnitId(sequence: number): string {
  return `narration-unit-${String(sequence + 1).padStart(4, "0")}`;
}

function sanitizeChildren(
  parentNode: DefaultTreeAdapterMap["parentNode"],
  state: { nextSourceKey: number },
): SafeNode[] {
  const safeNodes: SafeNode[] = [];

  for (const childNode of parentNode.childNodes) {
    if ("value" in childNode) {
      safeNodes.push({ type: "text", value: childNode.value.replace(/[\t\n\f\r ]+/gu, " ") });
      continue;
    }

    if (!("tagName" in childNode) || EXCLUDED_TAG_NAMES.has(childNode.tagName)) {
      continue;
    }

    const sourceKey = state.nextSourceKey;

    state.nextSourceKey += 1;

    const safeChildren = sanitizeChildren(childNode, state);

    if (
      !HEADING_TAG_NAMES.has(childNode.tagName) &&
      !STRUCTURAL_TAG_NAMES.has(childNode.tagName) &&
      !INLINE_TAG_NAMES.has(childNode.tagName)
    ) {
      if (FLATTENED_INLINE_TAG_NAMES.has(childNode.tagName)) {
        safeNodes.push(...safeChildren);
      } else {
        safeNodes.push({ type: "boundary", children: safeChildren });
      }

      continue;
    }

    safeNodes.push({
      type: "element",
      tagName: childNode.tagName,
      attributes: sanitizeAttributes(childNode),
      children: safeChildren,
      sourceKey,
    });
  }

  return safeNodes;
}

function sanitizeAttributes(element: DefaultTreeAdapterMap["element"]): SafeAttribute[] {
  const safeAttributes: SafeAttribute[] = [];

  for (const attribute of element.attrs) {
    if (attribute.name === "dir" && ["auto", "ltr", "rtl"].includes(attribute.value)) {
      safeAttributes.push({ name: attribute.name, value: attribute.value });
      continue;
    }

    if (attribute.name === "lang" && attribute.value.trim().length > 0) {
      safeAttributes.push({ name: attribute.name, value: attribute.value });
      continue;
    }

    if (element.tagName === "a" && attribute.name === "href" && isSafeLink(attribute.value)) {
      safeAttributes.push({ name: attribute.name, value: attribute.value });
    }
  }

  return safeAttributes;
}

function isSafeLink(href: string): boolean {
  if (href.trim().length === 0) {
    return false;
  }

  try {
    const url = new URL(href, "https://narration-document.invalid");

    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

function extractSafeText(nodes: readonly SafeNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") {
        return node.value;
      }

      return node.type === "element" && node.tagName === "br"
        ? "\n"
        : extractSafeText(node.children);
    })
    .join("");
}

function normalizeNarrationText(text: string): string {
  return text
    .replace(/\u00a0/gu, " ")
    .replace(/[\t\f\r ]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n+/gu, "\n")
    .trim();
}

function normalizeComparableNarrationText(text: string): string {
  return normalizeNarrationText(text).replace(/\s+/gu, " ");
}

function normalizeSafeElement(element: SafeElement): SafeElement {
  return { ...element, children: normalizeSafeNodes(element.children) };
}

// Keep browser-visible whitespace aligned with narration chunk normalization.
function normalizeSafeNodes(nodes: readonly SafeNode[]): SafeNode[] {
  const normalizedNodes: SafeNode[] = [];
  let hasVisibleText = false;
  let ignoreWhitespaceUntilVisibleText = true;
  let pendingSeparator: "line-break" | "space" | undefined;

  function normalizeTextNode(node: SafeText, output: SafeNode[]): void {
    for (const character of node.value.replace(/\u00a0/gu, " ")) {
      if (character === "\n") {
        if (!ignoreWhitespaceUntilVisibleText) {
          pendingSeparator = "line-break";
        }

        continue;
      }

      if (/[\t\f\r ]/u.test(character)) {
        if (!ignoreWhitespaceUntilVisibleText) {
          pendingSeparator ??= "space";
        }

        continue;
      }

      if (hasVisibleText && pendingSeparator === "line-break") {
        output.push({ type: "element", tagName: "br", attributes: [], children: [] });
      } else if (hasVisibleText && pendingSeparator === "space") {
        appendSafeText(output, " ");
      }

      appendSafeText(output, character);
      hasVisibleText = true;
      ignoreWhitespaceUntilVisibleText = false;
      pendingSeparator = undefined;
    }
  }

  function normalizeElementNode(node: SafeElement, output: SafeNode[]): void {
    if (node.tagName === "br") {
      if (!ignoreWhitespaceUntilVisibleText) {
        pendingSeparator = "line-break";
      }

      return;
    }

    const normalizedChildren: SafeNode[] = [];
    const elementText = extractSafeText(node.children);
    const hasElementText = normalizeNarrationText(elementText).length > 0;

    if (hasElementText) {
      const leadingWhitespace = elementText.match(/^[\u00a0\t\f\r \n]+/u)?.[0];
      const leadingSeparator = leadingWhitespace?.includes("\n") ? "line-break" : "space";

      if (hasVisibleText && (pendingSeparator || leadingWhitespace)) {
        if (pendingSeparator === "line-break" || leadingSeparator === "line-break") {
          output.push({ type: "element", tagName: "br", attributes: [], children: [] });
        } else {
          appendSafeText(output, " ");
        }
      }

      pendingSeparator = undefined;
      ignoreWhitespaceUntilVisibleText = Boolean(leadingWhitespace);
    }

    for (const childNode of node.children) {
      normalizeNode(childNode, normalizedChildren);
    }

    output.push({ ...node, children: normalizedChildren });
  }

  function normalizeNode(node: SafeNode, output: SafeNode[]): void {
    if (node.type === "boundary") {
      for (const childNode of node.children) {
        normalizeNode(childNode, output);
      }

      return;
    }

    if (node.type === "element") {
      normalizeElementNode(node, output);
      return;
    }

    normalizeTextNode(node, output);
  }

  for (const node of nodes) {
    normalizeNode(node, normalizedNodes);
  }

  return normalizedNodes;
}

function appendSafeText(output: SafeNode[], value: string): void {
  const lastNode = output[output.length - 1];

  if (lastNode?.type === "text") {
    lastNode.value += value;
  } else {
    output.push({ type: "text", value });
  }
}

function serializeSafeNode(node: SafeNode): string {
  if (node.type === "text") {
    return escapeHtmlText(node.value);
  }

  return node.type === "boundary"
    ? node.children.map(serializeSafeNode).join("")
    : serializeSafeElement(node);
}

function serializeSafeElement(
  element: SafeElement,
  generatedAttributes: readonly SafeAttribute[] = [],
): string {
  const attributes = serializeSafeAttributes([...generatedAttributes, ...element.attributes]);

  if (element.tagName === "br") {
    return `<br${attributes}>`;
  }

  return `<${element.tagName}${attributes}>${element.children.map(serializeSafeNode).join("")}</${element.tagName}>`;
}

function serializeRenderedUnits(renderedUnits: readonly RenderedUnit[]): string {
  let html = "";
  let unitIndex = 0;

  while (unitIndex < renderedUnits.length) {
    const renderedUnit = renderedUnits[unitIndex]!;
    const firstWrapper = renderedUnit.wrappers[0];

    if (!firstWrapper) {
      html += renderedUnit.html;
      unitIndex += 1;
      continue;
    }

    const wrappedUnits: RenderedUnit[] = [];

    while (unitIndex < renderedUnits.length) {
      const candidateUnit = renderedUnits[unitIndex]!;
      const candidateWrapper = candidateUnit.wrappers[0];

      if (!candidateWrapper || !areEquivalentWrappers(firstWrapper, candidateWrapper)) {
        break;
      }

      wrappedUnits.push({
        html: candidateUnit.html,
        wrappers: candidateUnit.wrappers.slice(1),
      });
      unitIndex += 1;
    }

    html += `<${firstWrapper.tagName}${serializeSafeAttributes(firstWrapper.attributes)}>${serializeRenderedUnits(wrappedUnits)}</${firstWrapper.tagName}>`;
  }

  return html;
}

function areEquivalentWrappers(first: SafeElement, second: SafeElement): boolean {
  return first.sourceKey !== undefined && first.sourceKey === second.sourceKey;
}

function serializeSafeAttributes(attributes: readonly SafeAttribute[]): string {
  return attributes.map(({ name, value }) => ` ${name}="${escapeHtmlAttribute(value)}"`).join("");
}

function serializeNarrationText(text: string): string {
  return text.split("\n").map(escapeHtmlText).join("<br>");
}

function escapeHtmlText(text: string): string {
  return text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

function escapeHtmlAttribute(text: string): string {
  return escapeHtmlText(text).replace(/"/gu, "&quot;");
}
