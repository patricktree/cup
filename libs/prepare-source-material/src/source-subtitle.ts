import { parseFragment } from "parse5";

import {
  collectMetadata,
  extractNodeText,
  findAllElements,
  findFirstElement,
  getAttribute,
  NARRATION_TEXT_ELEMENT_TAG_NAMES,
  normalizeWhitespace,
  type HtmlElement,
  type HtmlParentNode,
} from "#src/html-tree.ts";

// A `class`, `itemprop` or `data-*` word that marks a source subtitle candidate or its wrapper.
// Each word is proven by a recorded source page; add a word only with a fixture that needs it.
const SOURCE_SUBTITLE_WORDS = new Set<string>([
  "subtitle",
  "subheadline",
  "summary",
  "desc",
  "description",
]);
// Date and byline blocks between the visible headline and the source subtitle are skipped, never candidates.
const DATE_OR_BYLINE_CLASS_WORDS = new Set<string>(["author", "byline", "date"]);
const AUTHOR_LINK_SEPARATOR_WORDS = new Set<string>(["and", "und"]);
// Month and weekday names and their abbreviations in English and German, clock words, and English
// ordinal suffixes; a block whose words are all among them, beside digits, is a date.
const DATE_WORDS = new Set<string>(
  [
    "january february march april may june july august september october november december",
    "jan feb mar apr jun jul aug sep sept oct nov dec",
    "januar jänner februar märz mai juni juli oktober dezember jän mär okt dez",
    "monday tuesday wednesday thursday friday saturday sunday mon tue wed thu fri sat sun",
    "montag dienstag mittwoch donnerstag freitag samstag sonntag",
    "am pm uhr st nd rd th",
  ].flatMap((words) => words.split(" ")),
);
const META_DESCRIPTION_PROPERTIES = new Set<string>([
  "og:description",
  "description",
  "twitter:description",
]);

/**
 * Takes the first prose block, skipping date and byline blocks, as the only source subtitle
 * candidate. Precision beats recall: a candidate without an accepting signal means no source
 * subtitle, and no further block is tried.
 */
export function findSourceSubtitleElement(
  parentNode: HtmlParentNode,
  title: string,
  metadataDescriptions: readonly string[],
): HtmlElement | undefined {
  const candidate = findFirstElement(
    parentNode,
    (element) =>
      NARRATION_TEXT_ELEMENT_TAG_NAMES.has(element.tagName) &&
      normalizeWhitespace(extractNodeText(element)).length > 0 &&
      !isDateOrBylineBlock(element),
    // A skipped date or byline block is skipped whole.
    { shouldDescend: (element) => !NARRATION_TEXT_ELEMENT_TAG_NAMES.has(element.tagName) },
  );

  if (!candidate) {
    return undefined;
  }

  const candidateText = normalizeWhitespace(extractNodeText(candidate));
  const isAccepted =
    candidateText !== title &&
    (metadataDescriptions.some(
      (description) => normalizeWhitespace(description) === candidateText,
    ) ||
      hasSourceSubtitleAttributeWord(candidate));

  return isAccepted ? candidate : undefined;
}

/**
 * Reads the descriptions a page declares: Open Graph, page and Twitter card descriptions, the
 * `description` of each JSON-LD entity, and microdata `itemprop="description"` values.
 */
export function extractMetadataDescriptions(documentHtml: string): string[] {
  const documentFragment = parseFragment(documentHtml);
  const metaDescriptions = collectMetadata(documentFragment).flatMap(({ property, content }) =>
    META_DESCRIPTION_PROPERTIES.has(property) ? [content] : [],
  );
  const markupDescriptions = findAllElements(
    documentFragment,
    (element) => isJsonLinkedDataScript(element) || hasItemProperty(element, "description"),
  ).flatMap((element) => {
    if (isJsonLinkedDataScript(element)) {
      return extractJsonLinkedDataDescriptions(extractNodeText(element));
    }

    return [
      element.tagName === "meta"
        ? (getAttribute(element, "content") ?? "")
        : extractNodeText(element),
    ];
  });

  return [...metaDescriptions, ...markupDescriptions]
    .map((description) => normalizeWhitespace(description))
    .filter((description) => description.length > 0);
}

function isJsonLinkedDataScript(element: HtmlElement): boolean {
  return (
    element.tagName === "script" &&
    getAttribute(element, "type")?.trim().toLowerCase() === "application/ld+json"
  );
}

function hasItemProperty(element: HtmlElement, itemProperty: string): boolean {
  return getAttribute(element, "itemprop")?.split(/\s+/u).includes(itemProperty) ?? false;
}

function isDateOrBylineBlock(element: HtmlElement): boolean {
  const text = normalizeWhitespace(extractNodeText(element));

  return (
    isTimeOnlyBlock(element) ||
    isDateOnlyText(text) ||
    /^(?:By\s|Author:)/u.test(text) ||
    isAuthorLinkBlock(element) ||
    splitAttributeWords(getAttribute(element, "class") ?? "").some((word) =>
      DATE_OR_BYLINE_CLASS_WORDS.has(word),
    )
  );
}

/**
 * Whether the block holds nothing but `<time>` elements and separators. A standfirst can mention a
 * date in an inline `<time>` and stays a candidate.
 */
function isTimeOnlyBlock(element: HtmlElement): boolean {
  return (
    findFirstElement(element, isTimeElement) !== undefined &&
    !/[\p{L}\p{N}]/u.test(extractNodeText(element, isTimeElement))
  );
}

function isTimeElement(element: HtmlElement): boolean {
  return element.tagName === "time";
}

function isDateOnlyText(text: string): boolean {
  const words = text.match(/\p{L}+/gu) ?? [];

  return (
    /\d/u.test(text) &&
    /^[\p{L}\d\s.,:/-]+$/u.test(text) &&
    words.every((word) => DATE_WORDS.has(word.toLowerCase()))
  );
}

/** Whether the block's words are author link texts joined only by separators such as "and". */
function isAuthorLinkBlock(element: HtmlElement): boolean {
  const textOutsideAuthorLinks = extractNodeText(element, isAuthorLink);
  const separatorWords = textOutsideAuthorLinks.match(/\p{L}+/gu) ?? [];

  return (
    findFirstElement(element, isAuthorLink) !== undefined &&
    /^[\p{L}\s,&]*$/u.test(textOutsideAuthorLinks) &&
    separatorWords.every((word) => AUTHOR_LINK_SEPARATOR_WORDS.has(word.toLowerCase()))
  );
}

function isAuthorLink(element: HtmlElement): boolean {
  return (
    element.tagName === "a" &&
    ((getAttribute(element, "rel") ?? "").split(/\s+/u).includes("author") ||
      /\/authors?\//iu.test(getAttribute(element, "href") ?? ""))
  );
}

function hasSourceSubtitleAttributeWord(element: HtmlElement): boolean {
  const { parentNode } = element;
  const wrapper = parentNode && "tagName" in parentNode ? parentNode : undefined;

  return [element, ...(wrapper ? [wrapper] : [])].some((markedElement) =>
    markedElement.attrs.some(
      (attribute) =>
        (attribute.name === "class" ||
          attribute.name === "itemprop" ||
          attribute.name.startsWith("data-")) &&
        splitAttributeWords(attribute.value).some((word) => SOURCE_SUBTITLE_WORDS.has(word)),
    ),
  );
}

/** Splits an attribute value such as `ArticleSubtitle hero__sub-headline` into lowercase words. */
function splitAttributeWords(attributeValue: string): string[] {
  return attributeValue
    .split(/[^\p{L}\p{N}]+/u)
    .flatMap((token) => token.split(/(?<=[\p{Ll}\p{N}])(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/u))
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

/** Reads the `description` of each top-level and `@graph` entity; nested entities describe others. */
function extractJsonLinkedDataDescriptions(json: string): string[] {
  let linkedData: unknown;

  try {
    linkedData = JSON.parse(json);
  } catch {
    // Publisher markup is untrusted; malformed JSON-LD declares nothing.
    return [];
  }

  const entities = (Array.isArray(linkedData) ? linkedData : [linkedData]).flatMap(
    (entity: unknown) =>
      isRecord(entity) && Array.isArray(entity["@graph"])
        ? [entity, ...entity["@graph"]]
        : [entity],
  );

  return entities.flatMap((entity: unknown) =>
    isRecord(entity) && typeof entity["description"] === "string" ? [entity["description"]] : [],
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
