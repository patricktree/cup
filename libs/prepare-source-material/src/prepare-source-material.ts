import { parseFragment, serialize } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";

import {
  collectMetadata,
  extractNodeText,
  findAllElements,
  findFirstElement,
  getAttribute,
  isTemplateElement,
  NARRATION_TEXT_ELEMENT_TAG_NAMES,
  normalizeWhitespace,
  type HtmlElement,
  type HtmlParentNode,
  type Metadata,
} from "#src/html-tree.ts";
import { extractMetadataDescriptions, findSourceSubtitleElement } from "#src/source-subtitle.ts";

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
// The loader marks the visible headline in the source page; `prepareLoadedSourcePage` reads it.
export const VISIBLE_HEADLINE_ATTRIBUTE = "data-cup-visible-headline";
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
  /**
   * Descriptions the page declares in metadata; a source subtitle candidate whose
   * whitespace-normalized text equals one of them is accepted.
   */
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
  const visibleHeadline = findFirstElement(
    documentFragment,
    (element) => getAttribute(element, VISIBLE_HEADLINE_ATTRIBUTE) !== undefined,
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

  // After the cut, the first block in document order is the first block after the visible headline.
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

function removeElement(element: HtmlElement): void {
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
 * Open Graph attaches structured properties such as `og:image:secure_url` and `og:image:alt` to the
 * `og:image` they accompany. A page can declare several images; only the first one's properties are
 * returned, so a later image's properties never describe the first.
 */
function selectFirstOpenGraphImage(metadata: readonly Metadata[]): Metadata[] {
  const firstIndex = metadata.findIndex(isOpenGraphImageProperty);

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

function isOpenGraphImageProperty(item: Metadata): boolean {
  return item.property === "og:image" || item.property.startsWith("og:image:");
}

function findMetadataContent(metadata: readonly Metadata[], property: string): string | undefined {
  return metadata.find((item) => item.property === property)?.content;
}

/** Removes the element and everything before it in document order; its ancestors stay. */
function cutBeforeAndIncluding(element: HtmlElement): void {
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

function removeAttribute(parentNode: HtmlParentNode, attributeName: string): void {
  for (const element of findAllElements(parentNode, () => true)) {
    element.attrs = element.attrs.filter((attribute) => attribute.name !== attributeName);
  }
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
  const contentRoot =
    findFirstElement(documentFragment, (element) => element.tagName === "article") ??
    documentFragment;
  const narrationText = extractNarrationText(contentRoot);

  return normalizeWhitespace(narrationText || extractNodeText(contentRoot)).length;
}

function extractNarrationText(parentNode: HtmlParentNode): string {
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

function removeIrrelevantAndEmptyElements(parentNode: HtmlParentNode): void {
  for (let childIndex = parentNode.childNodes.length - 1; childIndex >= 0; childIndex -= 1) {
    const childNode = parentNode.childNodes[childIndex];

    if (childNode?.nodeName === "#comment") {
      parentNode.childNodes.splice(childIndex, 1);
      continue;
    }

    if (!childNode || !("tagName" in childNode)) {
      continue;
    }

    const role = getAttribute(childNode, "role");
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
