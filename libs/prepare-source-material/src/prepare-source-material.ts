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
// Keep equivalent static pages; rendering often adds small dynamic counters and page chrome.
const BETTER_SOURCE_MATERIAL_TEXT_FACTOR = 1.1;
const SOURCE_PAGE_JAVASCRIPT_MODES = [false, true] as const;
// A declaration travels in a workflow step result, so its size must stay bounded.
const MAX_HERO_IMAGE_URL_LENGTH = 2048;
const MAX_HERO_IMAGE_ALTERNATIVE_TEXT_LENGTH = 500;
// In order of preference; the secure variant names the same image as `og:image`.
const OPEN_GRAPH_IMAGE_PROPERTIES = ["og:image:secure_url", "og:image", "og:image:url"] as const;
const TWITTER_IMAGE_PROPERTIES = ["twitter:image", "twitter:image:src"] as const;
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
export type HeroImageDeclaration = {
  url: string;
  alternativeText?: string;
};

/** Cleaned source HTML, the title used to begin narration, and the declared hero image. */
export type SourceMaterial = {
  html: string;
  title: string;
  heroImage?: HeroImageDeclaration;
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
  heroImage?: HeroImageDeclaration;
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
    const { html, title } = selectBetterSourceMaterial(sourceMaterials);
    // Independent of which load has more text: the rendered load comes last, and its metadata is
    // the fuller declaration because a static shell often carries none or only a site-wide image.
    const heroImage = sourceMaterials.at(-1)?.heroImage ?? sourceMaterials[0]?.heroImage;

    return { html, title, ...(heroImage === undefined ? {} : { heroImage }) };
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

  return {
    html: cleanAudiobookSourceMaterialHtml(sourcePage.bodyHtml),
    title: extractSourceTitle(sourcePage.bodyHtml, sourcePage.documentTitle),
    ...(sourcePage.heroImage === undefined ? {} : { heroImage: sourcePage.heroImage }),
  };
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

    const heroImage = extractHeroImageDeclaration(await page.locator("head").innerHTML(), url);

    return {
      bodyHtml: await page.locator("body").innerHTML(),
      documentTitle: await page.title(),
      ...(heroImage === undefined ? {} : { heroImage }),
      responseStatus: response.status(),
    };
  } finally {
    await page.close();
  }
}

/** Reads the publisher-declared hero image from page metadata; body images are never considered. */
export function extractHeroImageDeclaration(
  headHtml: string,
  sourcePageUrl: string,
): HeroImageDeclaration | undefined {
  const metadata = collectMetadata(parseFragment(headHtml));
  const openGraphImage = findFirstMetadataContent(metadata, OPEN_GRAPH_IMAGE_PROPERTIES);
  const declaredUrl =
    openGraphImage ?? findFirstMetadataContent(metadata, TWITTER_IMAGE_PROPERTIES);

  if (declaredUrl === undefined || !URL.canParse(declaredUrl, sourcePageUrl)) {
    return undefined;
  }

  const url = new URL(declaredUrl, sourcePageUrl);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.href.length > MAX_HERO_IMAGE_URL_LENGTH
  ) {
    return undefined;
  }

  const alternativeText = findFirstMetadataContent(metadata, [
    openGraphImage === undefined ? "twitter:image:alt" : "og:image:alt",
  ])?.slice(0, MAX_HERO_IMAGE_ALTERNATIVE_TEXT_LENGTH);

  return { url: url.href, ...(alternativeText === undefined ? {} : { alternativeText }) };
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
    const content = normalizeTitleText(getAttribute("content") ?? "");

    return property && content.length > 0 ? [{ property, content }] : [];
  });
}

function findFirstMetadataContent(
  metadata: readonly Metadata[],
  properties: readonly string[],
): string | undefined {
  for (const property of properties) {
    const content = metadata.find((item) => item.property === property)?.content;

    if (content !== undefined) {
      return content;
    }
  }

  return undefined;
}

function extractSourceTitle(bodyHtml: string, documentTitle: string): string {
  const documentFragment = parseFragment(bodyHtml);
  const heading = findFirstElement(documentFragment, "h1");
  const title = normalizeTitleText(heading ? extractNodeText(heading) : documentTitle);

  if (title.length === 0) {
    throw new Error("Expected the source page to have a title");
  }

  return title;
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

  return normalizeTitleText(narrationText || extractNodeText(contentRoot)).length;
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

function normalizeTitleText(text: string): string {
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
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("Source URL must use HTTP or HTTPS");
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
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return true;
  const address = octets.reduce((result, octet) => result * 256 + octet, 0);
  return NON_PUBLIC_IPV4_RANGES.some(
    ([rangeStart, rangeEnd]) => address >= rangeStart && address <= rangeEnd,
  );
}

function isPrivateIpv6(hostname: string): boolean {
  if (!hostname.includes(":")) return false;
  const normalized = hostname.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (/^(?:fc|fd)/u.test(normalized) || /^fe[89ab]/u.test(normalized)) return true;
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
