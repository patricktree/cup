import { parseFragment, serialize } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";

/** A cookie installed before source-page navigation. */
export type SourcePageCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
};

const MEANINGFUL_EMPTY_ELEMENT_TAG_NAMES = new Set<string>([
  "audio",
  "br",
  "canvas",
  "embed",
  "hr",
  "iframe",
  "img",
  "object",
  "source",
  "track",
  "video",
  "wbr",
]);

const IRRELEVANT_ELEMENT_TAG_NAMES = new Set<string>([
  "button",
  "figure",
  "footer",
  "form",
  "input",
  "nav",
  "noscript",
  "script",
  "style",
  "svg",
]);
const NARRATION_TEXT_ELEMENT_TAG_NAMES = new Set<string>([
  "blockquote",
  "figcaption",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "p",
  "pre",
  "td",
  "th",
]);
// The loader marks the visible headline in the source page; `prepareLoadedSourcePage` reads it.
export const VISIBLE_HEADLINE_ATTRIBUTE = "data-cup-visible-headline";
// A `class`, `itemprop` or `data-*` word that marks a source subtitle candidate or its wrapper.
// Each word is proven by a recorded source page; add a word only with a fixture that needs it.
const SOURCE_SUBTITLE_WORDS = new Set<string>([
  "subtitle",
  "subheadline",
  "summary",
  "desc",
  "description",
]);
// Date and byline blocks between the headline and the source subtitle are skipped, never candidates.
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
// Keep equivalent static pages; rendering often adds small dynamic counters and page chrome.
const BETTER_SOURCE_MATERIAL_TEXT_FACTOR = 1.1;
const SOURCE_PAGE_JAVASCRIPT_MODES = [false, true] as const;
// A declaration travels in a workflow step result, so its size must stay bounded.
const MAX_COVER_IMAGE_URL_LENGTH = 2048;
const MAX_COVER_IMAGE_ALTERNATIVE_TEXT_LENGTH = 500;
// In order of preference; the secure variant names the same image as `og:image`.
const OPEN_GRAPH_IMAGE_URL_PROPERTIES = [
  "og:image:secure_url",
  "og:image",
  "og:image:url",
] as const;
const TWITTER_IMAGE_URL_PROPERTIES = ["twitter:image", "twitter:image:src"] as const;
const META_DESCRIPTION_PROPERTIES = new Set<string>([
  "og:description",
  "description",
  "twitter:description",
]);
const RENDERED_SOURCE_PAGE_READY_TIMEOUT_MS = 30_000;
const RENDERED_SOURCE_PAGE_READINESS = {
  minimumBlockCount: 2,
  minimumLongTextLength: 500,
  minimumTextLength: 200,
  narrationTextSelector: "blockquote, figcaption, h1, h2, h3, h4, h5, h6, li, p, pre, td, th",
} as const;
const NON_PUBLIC_IPV4_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00_00_00_00, 0x00_ff_ff_ff],
  [0x0a_00_00_00, 0x0a_ff_ff_ff],
  [0x64_40_00_00, 0x64_7f_ff_ff],
  [0x7f_00_00_00, 0x7f_ff_ff_ff],
  [0xa9_fe_00_00, 0xa9_fe_ff_ff],
  [0xac_10_00_00, 0xac_1f_ff_ff],
  [0xc0_00_00_00, 0xc0_00_00_ff],
  [0xc0_a8_00_00, 0xc0_a8_ff_ff],
  [0xc6_12_00_00, 0xc6_13_ff_ff],
  [0xe0_00_00_00, 0xff_ff_ff_ff],
];

type RenderedSourcePageReadinessOptions = typeof RENDERED_SOURCE_PAGE_READINESS;
type SourcePage = {
  route(pattern: string, handler: (route: InterceptedRoute) => Promise<void>): Promise<unknown>;
  context(): {
    addCookies(cookies: SourcePageCookie[]): Promise<void>;
  };
  goto(
    url: string,
    options: { waitUntil: "domcontentloaded" },
  ): Promise<{ status(): number } | null>;
  waitForFunction(
    pageFunction: (options: RenderedSourcePageReadinessOptions) => boolean,
    argument: RenderedSourcePageReadinessOptions,
    options: { timeout: number },
  ): Promise<unknown>;
  evaluate(pageFunction: (attributeName: string) => void, attributeName: string): Promise<unknown>;
  locator(selector: "body" | "head"): { innerHTML(): Promise<string> };
  title(): Promise<string>;
  close(): Promise<void>;
};

/** Supplies browser pages used to load source material. */
export type Browser = {
  newPage(options: { javaScriptEnabled: boolean }): Promise<SourcePage>;
};
type InterceptedRoute = {
  request(): { url(): string };
  continue(): Promise<void>;
  abort(errorCode: "blockedbyclient"): Promise<void>;
};

/** The image a source page declares in its metadata to represent its source content. */
export type CoverImageDeclaration = {
  url: string;
  alternativeText?: string;
};

/**
 * Cleaned source HTML, the title used to begin narration, the source subtitle when the page has
 * one, and the declared cover image.
 */
export type SourceMaterial = {
  html: string;
  title: string;
  subtitle?: string;
  coverImage?: CoverImageDeclaration;
};

/** Prepares source material from a URL through a supplied transport. */
export type SourceMaterialPreparer = (url: string) => Promise<SourceMaterial>;

/** Supplies the browser and URL used to load one source page. */
export type LoadSourcePageOptions = {
  cookies?: SourcePageCookie[];
  browser: Browser;
  javaScriptEnabled: boolean;
  url: string;
};

/** Browser-loaded page content before source cleanup and title selection. */
export type LoadedSourcePage = {
  bodyHtml: string;
  documentTitle: string;
  // Descriptions the page declares in metadata; a source subtitle candidate whose
  // whitespace-normalized text equals one of them is accepted.
  metadataDescriptions?: readonly string[];
  coverImage?: CoverImageDeclaration;
  responseStatus: number;
};

/** Loads source-page HTML and document metadata through a browser. */
export type SourcePageLoader = (options: LoadSourcePageOptions) => Promise<LoadedSourcePage>;

/** Supplies the browser, URL, and page loader used to prepare source material. */
export type PrepareOptions = Omit<LoadSourcePageOptions, "javaScriptEnabled"> & {
  loadSourcePage?: SourcePageLoader;
};

/** Loads static and rendered source-page candidates and selects the better source material. */
export async function prepareSourceMaterial({
  browser,
  cookies = [],
  url,
  loadSourcePage = loadPublicSourcePage,
}: PrepareOptions): Promise<SourceMaterial> {
  const results = await Promise.allSettled(
    SOURCE_PAGE_JAVASCRIPT_MODES.map(async (javaScriptEnabled) =>
      prepareLoadedSourcePage(await loadSourcePage({ browser, cookies, javaScriptEnabled, url })),
    ),
  );
  const sourceMaterials = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );

  if (sourceMaterials.length > 0) {
    // Each load detects its own source subtitle, so it always belongs to the selected HTML.
    const { html, title, subtitle } = selectBetterSourceMaterial(sourceMaterials);
    // Independent of which load has more text: `SOURCE_PAGE_JAVASCRIPT_MODES` puts the rendered
    // load last, and its metadata is the fuller declaration because a static shell often carries
    // none or only a site-wide image.
    const coverImage = sourceMaterials.at(-1)?.coverImage ?? sourceMaterials[0]?.coverImage;

    return {
      html,
      title,
      ...(subtitle === undefined ? {} : { subtitle }),
      ...(coverImage === undefined ? {} : { coverImage }),
    };
  }

  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  const failureDescriptions = results.map((result, resultIndex) => {
    const loadMode = SOURCE_PAGE_JAVASCRIPT_MODES[resultIndex] ? "rendered" : "static";
    return `${loadMode}: ${result.status === "rejected" ? describeError(result.reason) : "no usable source material"}`;
  });

  throw new AggregateError(
    failures,
    `Expected at least one source-page load to produce audiobook source material (${failureDescriptions.join("; ")})`,
  );
}

/** Applies production cleanup and title selection to an already loaded source page. */
export function prepareLoadedSourcePage(sourcePage: LoadedSourcePage): SourceMaterial {
  if (sourcePage.responseStatus < 200 || sourcePage.responseStatus >= 300) {
    throw new Error(`Source page responded with HTTP ${sourcePage.responseStatus}`);
  }

  const documentFragment = parseFragment(sourcePage.bodyHtml);
  const visibleHeadline = findFirstElementWithAttribute(
    documentFragment,
    VISIBLE_HEADLINE_ATTRIBUTE,
  );
  const title = normalizeWhitespace(
    visibleHeadline ? extractNodeText(visibleHeadline) : sourcePage.documentTitle,
  );

  if (title.length === 0) {
    throw new Error("Expected the source page to have a title");
  }

  if (visibleHeadline) {
    cutBeforeAndIncluding(visibleHeadline);
  }
  removeAttribute(documentFragment, VISIBLE_HEADLINE_ATTRIBUTE);
  removeIrrelevantAndEmptyElements(documentFragment);

  // After the cut, the first block in document order is the first block after the headline.
  const subtitleElement = visibleHeadline
    ? findSourceSubtitleElement(documentFragment, title, sourcePage.metadataDescriptions ?? [])
    : undefined;
  const subtitle = subtitleElement && normalizeWhitespace(extractNodeText(subtitleElement));

  if (subtitleElement) {
    removeElement(subtitleElement);
    // The source subtitle's wrapper can be left empty.
    removeIrrelevantAndEmptyElements(documentFragment);
  }

  return {
    html: serialize(documentFragment),
    title,
    ...(subtitle === undefined ? {} : { subtitle }),
    ...(sourcePage.coverImage === undefined ? {} : { coverImage: sourcePage.coverImage }),
  };
}

/**
 * Takes the first prose block, skipping date and byline blocks, as the only source subtitle
 * candidate. Precision beats recall: a candidate without an accepting signal means no source
 * subtitle, and no further block is tried.
 */
function findSourceSubtitleElement(
  parentNode: DefaultTreeAdapterMap["parentNode"],
  title: string,
  metadataDescriptions: readonly string[],
): DefaultTreeAdapterMap["element"] | undefined {
  const candidate = findFirstProseBlock(parentNode);

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

function findFirstProseBlock(
  parentNode: DefaultTreeAdapterMap["parentNode"],
): DefaultTreeAdapterMap["element"] | undefined {
  for (const childNode of parentNode.childNodes) {
    if (!("tagName" in childNode)) {
      continue;
    }

    if (NARRATION_TEXT_ELEMENT_TAG_NAMES.has(childNode.tagName)) {
      if (normalizeWhitespace(extractNodeText(childNode)).length === 0) {
        continue;
      }

      if (!isDateOrBylineBlock(childNode)) {
        return childNode;
      }

      continue;
    }

    const descendant = findFirstProseBlock(
      isTemplateElement(childNode) ? childNode.content : childNode,
    );

    if (descendant) {
      return descendant;
    }
  }

  return undefined;
}

function isDateOrBylineBlock(element: DefaultTreeAdapterMap["element"]): boolean {
  const text = normalizeWhitespace(extractNodeText(element));
  const className = element.attrs.find((attribute) => attribute.name === "class")?.value ?? "";

  return (
    findFirstElement(element, "time") !== undefined ||
    isDateOnlyText(text) ||
    /^(?:By\s|Author:)/u.test(text) ||
    isAuthorLinkBlock(element) ||
    splitAttributeWords(className).some((word) => DATE_OR_BYLINE_CLASS_WORDS.has(word))
  );
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
function isAuthorLinkBlock(element: DefaultTreeAdapterMap["element"]): boolean {
  let hasAuthorLink = false;
  const collectTextOutsideAuthorLinks = (parentNode: DefaultTreeAdapterMap["parentNode"]): string =>
    parentNode.childNodes
      .map((childNode) => {
        if ("value" in childNode) {
          return childNode.value;
        }

        if (!("tagName" in childNode)) {
          return "";
        }

        if (childNode.tagName === "a" && isAuthorLink(childNode)) {
          hasAuthorLink = true;
          return " ";
        }

        return collectTextOutsideAuthorLinks(childNode);
      })
      .join("");
  const textOutsideAuthorLinks = collectTextOutsideAuthorLinks(element);
  const separatorWords = textOutsideAuthorLinks.match(/\p{L}+/gu) ?? [];

  return (
    hasAuthorLink &&
    /^[\p{L}\s,&]*$/u.test(textOutsideAuthorLinks) &&
    separatorWords.every((word) => AUTHOR_LINK_SEPARATOR_WORDS.has(word.toLowerCase()))
  );
}

function isAuthorLink(link: DefaultTreeAdapterMap["element"]): boolean {
  const getAttribute = (name: string) =>
    link.attrs.find((attribute) => attribute.name === name)?.value ?? "";

  return (
    getAttribute("rel").split(/\s+/u).includes("author") ||
    /\/authors?\//iu.test(getAttribute("href"))
  );
}

function hasSourceSubtitleAttributeWord(element: DefaultTreeAdapterMap["element"]): boolean {
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

function removeElement(element: DefaultTreeAdapterMap["element"]): void {
  const { parentNode } = element;

  if (!parentNode) {
    throw new Error("Expected the source subtitle element to have a parent node");
  }

  parentNode.childNodes.splice(parentNode.childNodes.indexOf(element), 1);
}

/** Loads a public source page while blocking scripts and non-public subresources. */
export async function loadPublicSourcePage({
  browser,
  cookies = [],
  javaScriptEnabled,
  url,
}: LoadSourcePageOptions): Promise<LoadedSourcePage> {
  const page = await browser.newPage({ javaScriptEnabled });

  try {
    assertPublicSourceUrl(url);
    await page.route("**/*", async (route: InterceptedRoute) => {
      try {
        assertPublicSourceUrl(route.request().url());
        await route.continue();
      } catch {
        await route.abort("blockedbyclient");
      }
    });
    if (cookies.length > 0) {
      await page.context().addCookies(cookies);
    }
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });

    if (!response) {
      throw new Error("Expected source-page navigation to return an HTTP response");
    }

    if (javaScriptEnabled) {
      await page.waitForFunction(
        (options) => {
          const title = document.querySelector("h1")?.textContent?.trim() || document.title.trim();

          if (!title) {
            return false;
          }

          const semanticContentRoots = Array.from(
            document.querySelectorAll("article, main"),
          ).filter((element) => element.querySelector(options.narrationTextSelector));
          const contentRoots =
            semanticContentRoots.length > 0 ? semanticContentRoots : [document.body];

          return contentRoots.some((contentRoot) => {
            const narrationBlocks = Array.from(
              contentRoot.querySelectorAll(options.narrationTextSelector),
            )
              .filter((element) => !element.closest("footer, form, nav"))
              .map((element) => element.textContent?.replace(/\s+/g, " ").trim() ?? "")
              .filter((text) => text.length > 0);
            const narrationTextLength = narrationBlocks.reduce(
              (totalLength, text) => totalLength + text.length,
              0,
            );

            return (
              narrationTextLength >= options.minimumLongTextLength ||
              (narrationBlocks.length >= options.minimumBlockCount &&
                narrationTextLength >= options.minimumTextLength)
            );
          });
        },
        RENDERED_SOURCE_PAGE_READINESS,
        { timeout: RENDERED_SOURCE_PAGE_READY_TIMEOUT_MS },
      );
    }

    const headHtml = await page.locator("head").innerHTML();
    const coverImage = extractCoverImageDeclaration(headHtml, url);
    // The mark must be in the DOM before the body is serialized below.
    await page.evaluate(markVisibleHeadline, VISIBLE_HEADLINE_ATTRIBUTE);
    const bodyHtml = await page.locator("body").innerHTML();

    return {
      bodyHtml,
      documentTitle: await page.title(),
      // `bodyHtml` lacks the head, and cleanup in `prepareLoadedSourcePage` drops body scripts.
      metadataDescriptions: extractMetadataDescriptions(`${headHtml}${bodyHtml}`),
      ...(coverImage === undefined ? {} : { coverImage }),
      responseStatus: response.status(),
    };
  } finally {
    await page.close();
  }
}

/**
 * Marks the first `<h1>` that renders visibly with {@link VISIBLE_HEADLINE_ATTRIBUTE}, so the
 * source title never comes from a hidden heading such as a consent wall's. The browser serializes
 * this function into the source page, so it must stay self-contained.
 */
function markVisibleHeadline(attributeName: string): void {
  const visibleHeadline = Array.from(document.querySelectorAll("h1")).find((heading) => {
    const boundingRectangle = heading.getBoundingClientRect();

    return (
      (heading.textContent?.trim() ?? "").length > 0 &&
      heading.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
      // Visually hidden headings, such as `.sr-only`, keep a one-pixel box.
      boundingRectangle.width > 1 &&
      boundingRectangle.height > 1
    );
  });

  visibleHeadline?.setAttribute(attributeName, "");
}

/** Reads the publisher-declared cover image from page metadata; body images are never considered. */
export function extractCoverImageDeclaration(
  headHtml: string,
  sourcePageUrl: string,
): CoverImageDeclaration | undefined {
  const metadata = collectMetadata(parseFragment(headHtml));
  const openGraphImage = selectFirstOpenGraphImage(metadata);
  // Each candidate keeps the alternative text declared for it. An unusable declaration, such as
  // an embedded image, falls through to the next candidate.
  const candidates = [
    ...OPEN_GRAPH_IMAGE_URL_PROPERTIES.map((property) => ({
      declaredUrl: findMetadataContent(openGraphImage, property),
      alternativeText: findMetadataContent(openGraphImage, "og:image:alt"),
    })),
    ...TWITTER_IMAGE_URL_PROPERTIES.map((property) => ({
      declaredUrl: findMetadataContent(metadata, property),
      alternativeText: findMetadataContent(metadata, "twitter:image:alt"),
    })),
  ];

  for (const { declaredUrl, alternativeText } of candidates) {
    const url = resolveCoverImageUrl(declaredUrl, sourcePageUrl);

    if (url !== undefined) {
      return {
        url,
        ...(alternativeText === undefined
          ? {}
          : { alternativeText: alternativeText.slice(0, MAX_COVER_IMAGE_ALTERNATIVE_TEXT_LENGTH) }),
      };
    }
  }

  return undefined;
}

function resolveCoverImageUrl(
  declaredUrl: string | undefined,
  sourcePageUrl: string,
): string | undefined {
  if (declaredUrl === undefined || !URL.canParse(declaredUrl, sourcePageUrl)) {
    return undefined;
  }

  const url = new URL(declaredUrl, sourcePageUrl);

  return (url.protocol === "http:" || url.protocol === "https:") &&
    url.href.length <= MAX_COVER_IMAGE_URL_LENGTH
    ? url.href
    : undefined;
}

/**
 * Reads the descriptions a page declares: Open Graph, page and Twitter card descriptions, the
 * `description` of each JSON-LD entity, and microdata `itemprop="description"` values.
 */
function extractMetadataDescriptions(documentHtml: string): string[] {
  const documentFragment = parseFragment(documentHtml);
  const metaDescriptions = collectMetadata(documentFragment).flatMap(({ property, content }) =>
    META_DESCRIPTION_PROPERTIES.has(property) ? [content] : [],
  );
  const descriptions: string[] = [];
  const collectMarkupDescriptions = (parentNode: DefaultTreeAdapterMap["parentNode"]) => {
    for (const childNode of parentNode.childNodes) {
      if (!("tagName" in childNode)) {
        continue;
      }

      const getAttribute = (name: string) =>
        childNode.attrs.find((attribute) => attribute.name === name)?.value;

      if (
        childNode.tagName === "script" &&
        getAttribute("type")?.trim().toLowerCase() === "application/ld+json"
      ) {
        descriptions.push(...extractJsonLinkedDataDescriptions(extractNodeText(childNode)));
        continue;
      }

      if (getAttribute("itemprop")?.split(/\s+/u).includes("description")) {
        descriptions.push(
          childNode.tagName === "meta"
            ? (getAttribute("content") ?? "")
            : extractNodeText(childNode),
        );
      }

      collectMarkupDescriptions(isTemplateElement(childNode) ? childNode.content : childNode);
    }
  };

  collectMarkupDescriptions(documentFragment);

  return [...metaDescriptions, ...descriptions]
    .map((description) => normalizeWhitespace(description))
    .filter((description) => description.length > 0);
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

type Metadata = { property: string; content: string };

function collectMetadata(parentNode: DefaultTreeAdapterMap["parentNode"]): Metadata[] {
  return parentNode.childNodes.flatMap((childNode) => {
    if (!("tagName" in childNode)) {
      return [];
    }

    if (childNode.tagName !== "meta") {
      return collectMetadata(childNode);
    }

    const getAttribute = (name: string) =>
      childNode.attrs.find((attribute) => attribute.name === name)?.value;
    // Open Graph uses `property`; Twitter cards and many publishers use `name` for either.
    const property = (getAttribute("property") ?? getAttribute("name"))?.trim().toLowerCase();
    const content = normalizeWhitespace(getAttribute("content") ?? "");

    return property && content.length > 0 ? [{ property, content }] : [];
  });
}

/**
 * Open Graph attaches structured properties such as `og:image:secure_url` and `og:image:alt` to the
 * `og:image` they accompany. A page can declare several images; only the first one's properties are
 * returned, so a later image's properties never describe the first.
 */
function selectFirstOpenGraphImage(metadata: readonly Metadata[]): Metadata[] {
  const isImageProperty = (item: Metadata) =>
    item.property === "og:image" || item.property.startsWith("og:image:");
  const firstIndex = metadata.findIndex(isImageProperty);

  if (firstIndex === -1) {
    return [];
  }

  const imageIndex = metadata.findIndex(
    (item, index) => index >= firstIndex && item.property === "og:image",
  );
  const nextImageIndex =
    imageIndex === -1
      ? -1
      : metadata.findIndex((item, index) => index > imageIndex && item.property === "og:image");

  return metadata.slice(firstIndex, nextImageIndex === -1 ? undefined : nextImageIndex);
}

function findMetadataContent(metadata: readonly Metadata[], property: string): string | undefined {
  return metadata.find((item) => item.property === property)?.content;
}

function findFirstElementWithAttribute(
  parentNode: DefaultTreeAdapterMap["parentNode"],
  attributeName: string,
): DefaultTreeAdapterMap["element"] | undefined {
  for (const childNode of parentNode.childNodes) {
    if (!("tagName" in childNode)) {
      continue;
    }

    if (childNode.attrs.some((attribute) => attribute.name === attributeName)) {
      return childNode;
    }

    const descendant = findFirstElementWithAttribute(childNode, attributeName);

    if (descendant) {
      return descendant;
    }
  }

  return undefined;
}

/** Removes the element and everything before it in document order; its ancestors stay. */
function cutBeforeAndIncluding(element: DefaultTreeAdapterMap["element"]): void {
  let node: DefaultTreeAdapterMap["childNode"] = element;
  let parentNode = element.parentNode;
  let shouldRemoveNode = true;

  while (parentNode) {
    const nodeIndex = parentNode.childNodes.indexOf(node);
    parentNode.childNodes.splice(0, shouldRemoveNode ? nodeIndex + 1 : nodeIndex);

    if (!("tagName" in parentNode)) {
      break;
    }

    node = parentNode;
    parentNode = parentNode.parentNode;
    shouldRemoveNode = false;
  }
}

function removeAttribute(
  parentNode: DefaultTreeAdapterMap["parentNode"],
  attributeName: string,
): void {
  for (const childNode of parentNode.childNodes) {
    if (!("tagName" in childNode)) {
      continue;
    }

    childNode.attrs = childNode.attrs.filter((attribute) => attribute.name !== attributeName);
    removeAttribute(isTemplateElement(childNode) ? childNode.content : childNode, attributeName);
  }
}

function findFirstElement(
  parentNode: DefaultTreeAdapterMap["parentNode"],
  tagName: string,
): DefaultTreeAdapterMap["element"] | undefined {
  for (const childNode of parentNode.childNodes) {
    if (!("tagName" in childNode)) {
      continue;
    }

    if (childNode.tagName === tagName) {
      return childNode;
    }

    const descendant = findFirstElement(childNode, tagName);

    if (descendant) {
      return descendant;
    }
  }

  return undefined;
}

function selectBetterSourceMaterial(sourceMaterials: readonly SourceMaterial[]): SourceMaterial {
  const [firstSourceMaterial, ...remainingSourceMaterials] = sourceMaterials;

  if (!firstSourceMaterial) {
    throw new Error("Expected at least one prepared source material candidate");
  }

  return remainingSourceMaterials.reduce(
    (bestSourceMaterial, sourceMaterial) =>
      getSourceMaterialTextLength(sourceMaterial) >
      getSourceMaterialTextLength(bestSourceMaterial) * BETTER_SOURCE_MATERIAL_TEXT_FACTOR
        ? sourceMaterial
        : bestSourceMaterial,
    firstSourceMaterial,
  );
}

function getSourceMaterialTextLength(sourceMaterial: SourceMaterial): number {
  const documentFragment = parseFragment(sourceMaterial.html);
  const contentRoot = findFirstElement(documentFragment, "article") ?? documentFragment;
  const narrationText = extractNarrationText(contentRoot);

  return normalizeWhitespace(narrationText || extractNodeText(contentRoot)).length;
}

function extractNarrationText(parentNode: DefaultTreeAdapterMap["parentNode"]): string {
  return parentNode.childNodes
    .map((childNode) => {
      if (!("tagName" in childNode)) {
        return "";
      }

      return NARRATION_TEXT_ELEMENT_TAG_NAMES.has(childNode.tagName)
        ? extractNodeText(childNode)
        : extractNarrationText(childNode);
    })
    .join("");
}

function extractNodeText(parentNode: DefaultTreeAdapterMap["parentNode"]): string {
  return parentNode.childNodes
    .map((childNode) => {
      if ("value" in childNode) {
        return childNode.value;
      }

      return "tagName" in childNode ? extractNodeText(childNode) : "";
    })
    .join("");
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export function cleanAudiobookSourceMaterialHtml(html: string): string {
  const documentFragment = parseFragment(html);

  removeIrrelevantAndEmptyElements(documentFragment);

  return serialize(documentFragment);
}

/** Rejects private, loopback, link-local, and metadata-service destinations. */
export function assertPublicSourceUrl(value: string): void {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Source URL must use HTTP or HTTPS");
  }
  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[(.*)\]$/u, "$1")
    .replace(/\.$/u, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === "metadata.google.internal" ||
    isPrivateIpv4(hostname) ||
    isPrivateIpv6(hostname)
  ) {
    throw new Error("Source destination is not public");
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part))) {
    return false;
  }
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) {
    return true;
  }
  const address = octets.reduce((result, octet) => result * 256 + octet, 0);
  return NON_PUBLIC_IPV4_RANGES.some(
    ([rangeStart, rangeEnd]) => address >= rangeStart && address <= rangeEnd,
  );
}

function isPrivateIpv6(hostname: string): boolean {
  if (!hostname.includes(":")) {
    return false;
  }
  const normalized = hostname.toLowerCase();
  if (normalized === "::" || normalized === "::1") {
    return true;
  }
  if (/^(?:fc|fd)/u.test(normalized) || /^fe[89ab]/u.test(normalized)) {
    return true;
  }
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(normalized)?.[1];
  return mapped !== undefined && isPrivateIpv4(mapped);
}

function removeIrrelevantAndEmptyElements(parentNode: DefaultTreeAdapterMap["parentNode"]): void {
  for (let childIndex = parentNode.childNodes.length - 1; childIndex >= 0; childIndex -= 1) {
    const childNode = parentNode.childNodes[childIndex];

    if (childNode?.nodeName === "#comment") {
      parentNode.childNodes.splice(childIndex, 1);
      continue;
    }

    if (!childNode || !("tagName" in childNode)) {
      continue;
    }

    const role = childNode.attrs.find((attribute) => attribute.name === "role")?.value;
    if (
      IRRELEVANT_ELEMENT_TAG_NAMES.has(childNode.tagName) ||
      role === "navigation" ||
      role === "search"
    ) {
      parentNode.childNodes.splice(childIndex, 1);
      continue;
    }

    const content = isTemplateElement(childNode) ? childNode.content : childNode;
    removeIrrelevantAndEmptyElements(content);

    if (
      MEANINGFUL_EMPTY_ELEMENT_TAG_NAMES.has(childNode.tagName) ||
      content.childNodes.some(
        (grandchildNode) =>
          "tagName" in grandchildNode ||
          (grandchildNode.nodeName === "#text" && Boolean(grandchildNode.value.trim())),
      )
    ) {
      continue;
    }

    parentNode.childNodes.splice(childIndex, 1);
  }
}

function isTemplateElement(
  element: DefaultTreeAdapterMap["element"],
): element is DefaultTreeAdapterMap["template"] {
  return element.tagName === "template" && "content" in element;
}
