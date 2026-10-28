import { expect, test } from "@playwright/test";
import type { APIRequestContext, Browser } from "@playwright/test";
import { format } from "oxfmt";
import { parseFragment, serializeOuter } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";

import { type CoverImageBrowser, loadCoverImage } from "#src/load-cover-image.ts";
import {
  type Browser as SourceMaterialBrowser,
  prepareLoadedSourcePage,
  prepareSourceMaterial,
  loadPublicSourcePage,
} from "#src/prepare-source-material.ts";

type SourcePageFixture = {
  coverImage: { url: string; alternativeText?: string };
  snapshotFilename: string;
  stabilizeSourceMaterial: (html: string) => string;
  // The visible headline; the cut removes it and everything before it.
  title: string;
  // Text the page sets above its visible headline, which the cut removes.
  textBeforeHeadline: readonly string[];
  // Requests the recording does not answer: unavailable at capture time, or with query values that
  // change on every load. The page loads without them.
  unrecordedRequests?: readonly RegExp[];
  url: string;
};

const SOURCE_PAGES: readonly SourcePageFixture[] = [
  {
    coverImage: {
      url: "https://www-cdn.anthropic.com/images/4zrzovbb/website/412be842c5c6bae6b4bcd515c191b0aa5015e05f-2400x1260.png",
      alternativeText: "Demystifying evals for AI agents",
    },
    snapshotFilename: "anthropic.html",
    stabilizeSourceMaterial: (html: string) =>
      html.replace(
        /http:\/\/claude\.ai\/redirect\/website\.v1\.[^"]+/g,
        "http://claude.ai/redirect/[redirect-id]",
      ),
    title: "Demystifying evals for AI agents",
    textBeforeHeadline: ["Engineering at Anthropic"],
    url: "https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents",
  },
  {
    coverImage: {
      url: "https://blog.cloudflare.com/_emdash/api/media/file/01KZBWYMKT77FDVB07PHA3R5WM.png",
    },
    snapshotFilename: "cloudflare.html",
    stabilizeSourceMaterial: (html: string) => html,
    title:
      "Introducing Kitesurf: The agent-first browser that runs in V8 isolates on Cloudflare Workers",
    textBeforeHeadline: ["Skip to content"],
    url: "https://blog.cloudflare.com/kitesurf/",
  },
  {
    coverImage: {
      url: "https://images.gatesnotes.com/12514eb8-7b51-008e-41a9-512542cf683b/f93f0cc8-be6d-4e33-870b-ab6d546576f1/AI-Article-08.19.2026-Share-Image-1200x630.jpg",
    },
    snapshotFilename: "gates-notes.html",
    stabilizeSourceMaterial: (html: string) =>
      extractElementById(html, "a_turbulent_ai_era_and_critical_choices_to_make_a").replace(
        /(published <span class="ArtDateTime">)[^<]+(<\/span>)/,
        "$1[relative publication date]$2",
      ),
    title: "The turbulent AI era is here. The choices we make now are critical.",
    textBeforeHeadline: ["An epochal shift"],
    url: "https://www.gatesnotes.com/a-turbulent-ai-era-and-critical-choices-to-make",
  },
  {
    coverImage: {
      url: "https://i.ds.at/kJMDLg/rs:fill:1200:600/plain/lido-images/2026/10/27/4e361b46-b4dd-454e-a75b-335dbb5ac943.jpg",
    },
    snapshotFilename: "derstandard.html",
    stabilizeSourceMaterial: (html: string) => html,
    title: "BYD will mit neuer Luxus-Limousine Rolls-Royce und Maybach Konkurrenz machen",
    textBeforeHeadline: ["Obere Oberklasse"],
    // The browser save holds only the scripts the page references, not the chunks they import.
    unrecordedRequests: [
      /^https:\/\/b\.staticfiles\.at\/lib\/k13m\/assets\/(?:index|preload-helper|Component|config)-[\w-]+\.js$/u,
      /^https:\/\/b\.staticfiles\.at\/lib\/dst-readinglist\/assets\/dst-readinglist-[\w-]+\.js$/u,
      /^https:\/\/b\.staticfiles\.at\/adjs\/chunk-[\w-]+\.js$/u,
      /^https:\/\/b\.staticfiles\.at\/standard-light\/assets\/DstDiscover-[\w-]+\.js$/u,
      /^https:\/\/b\.staticfiles\.at\/forum\/v2\/dst-forum\/index\.js$/u,
    ],
    url: "https://www.derstandard.at/story/3000000346146/byd-will-mit-neuer-luxus-limousine-rolls-royce-und-maybach-konkurrenz-machen",
  },
  {
    coverImage: {
      url: "https://developers.openai.com/images/blog/maintaining-software-with-the-gpt-6-family/cover.webp",
      alternativeText: "Maintaining software with the GPT-6 family | OpenAI Developers",
    },
    snapshotFilename: "openai-developers.html",
    stabilizeSourceMaterial: (html: string) => html,
    title: "Maintaining software with the GPT-6 family",
    textBeforeHeadline: [],
    url: "https://developers.openai.com/blog/maintaining-software-with-the-gpt-6-family",
  },
  {
    coverImage: {
      url: "https://www.washingtonpost.com/wp-apps/imrs.php?src=https://cloudfront-us-east-1.images.arcpublishing.com/wapo/FDOM3ZHHDNC5HBXBMB3JHXI5JU.png&w=1440",
    },
    snapshotFilename: "washington-post.html",
    stabilizeSourceMaterial: (html: string) => html,
    title: "The seven races that will decide control of the Senate",
    textBeforeHeadline: [],
    unrecordedRequests: [
      /^https:\/\/www\.washingtonpost\.com\/subscribe\/user\/auth-status\?/u,
      /^https:\/\/www\.washingtonpost\.com\/red-static\/services\/dat\/\?/u,
    ],
    url: "https://www.washingtonpost.com/politics/2026/10/28/these-seven-races-will-determine-which-party-controls-senate/",
  },
  {
    coverImage: {
      url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b8/Kitesurfing_Sotavento.jpg/960px-Kitesurfing_Sotavento.jpg?utm_source=en.wikipedia.org&utm_campaign=index&utm_content=thumbnail",
    },
    snapshotFilename: "wikipedia.html",
    stabilizeSourceMaterial: (html: string) => html,
    title: "Kiteboarding",
    textBeforeHeadline: [],
    unrecordedRequests: [/^https:\/\/en\.wikipedia\.org\/wiki\/Special:CentralAutoLogin\//u],
    url: "https://en.wikipedia.org/wiki/Kitesurfing",
  },
];

for (const {
  coverImage,
  snapshotFilename,
  stabilizeSourceMaterial,
  textBeforeHeadline,
  title,
  unrecordedRequests = [],
  url,
} of SOURCE_PAGES) {
  test(`prepares source material for ${url}`, async ({ browser: playwrightBrowser, request }) => {
    const missingRecordings: string[] = [];
    const browser = createFixtureBrowser(playwrightBrowser, request, missingRecordings);

    if (snapshotFilename === "gates-notes.html") {
      const staticPage = await loadPublicSourcePage({ browser, javaScriptEnabled: false, url });
      expect(staticPage.bodyHtml).toContain('<div id="__next"></div>');
      expect(staticPage.bodyHtml).not.toContain(
        "a_turbulent_ai_era_and_critical_choices_to_make_a",
      );
      expect(staticPage.documentTitle).toBe("");
      // The shell declares no metadata; the cover image exists only in the rendered head.
      expect(staticPage.coverImage).toBeUndefined();
    }

    const sourceMaterial = await prepareSourceMaterial({ browser, url });
    const fullHtml = `<html><head><title>${escapeHtml(sourceMaterial.title)}</title></head><body>${sourceMaterial.html}</body></html>`;
    const stableFullHtml = stabilizeSourceMaterial(fullHtml);
    const { code: formattedFullHtml } = await format(snapshotFilename, stableFullHtml);

    expect(
      missingRecordings.filter(
        (missingUrl) => !unrecordedRequests.some((pattern) => pattern.test(missingUrl)),
      ),
    ).toEqual([]);
    expect(sourceMaterial.coverImage).toEqual(coverImage);
    expect(sourceMaterial.title).toBe(title);
    expect(extractHeadingTexts(sourceMaterial.html)).not.toContain(title);
    for (const text of textBeforeHeadline) {
      expect(sourceMaterial.html).not.toContain(text);
    }
    expect(formattedFullHtml).toMatchSnapshot(snapshotFilename);
  });
}

for (const javaScriptEnabled of [false, true]) {
  test(`takes the source title from the first visibly rendered h1 (JavaScript enabled: ${javaScriptEnabled})`, async ({
    browser: playwrightBrowser,
  }) => {
    const sourcePageHtml = `<!doctype html>
      <html>
        <head>
          <title>Document title | Publisher</title>
          <style>
            .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
          </style>
        </head>
        <body>
          <div style="display: none"><h1>Consent wall</h1></div>
          <h1 class="sr-only">Screen-reader heading</h1>
          <h1 style="visibility: hidden">Invisible heading</h1>
          <h1 style="opacity: 0">Transparent heading</h1>
          <h1></h1>
          <p>Kicker</p>
          <h1>Visible headline</h1>
          <p>This complete source paragraph contains enough narration text to count as rendered source content.</p>
          <p>A second paragraph completes the rendered source content.</p>
        </body>
      </html>`;
    const browser: SourceMaterialBrowser = {
      newPage: async (options) => {
        const page = await playwrightBrowser.newPage(options);

        return {
          route: (pattern, handler) =>
            page.route(pattern, (route) =>
              handler({
                request: () => route.request(),
                abort: (errorCode) => route.abort(errorCode),
                continue: () => route.fulfill({ body: sourcePageHtml, contentType: "text/html" }),
              }),
            ),
          context: () => page.context(),
          goto: (url, gotoOptions) => page.goto(url, gotoOptions),
          waitForFunction: (pageFunction, argument, waitOptions) =>
            page.waitForFunction(pageFunction, argument, waitOptions),
          evaluate: (pageFunction, attributeName) => page.evaluate(pageFunction, attributeName),
          locator: (selector) => page.locator(selector),
          title: () => page.title(),
          close: () => page.close(),
        };
      },
    };

    const sourceMaterial = prepareLoadedSourcePage(
      await loadPublicSourcePage({
        browser,
        javaScriptEnabled,
        url: "https://publisher.example/story",
      }),
    );

    expect(sourceMaterial.title).toBe("Visible headline");
    expect(sourceMaterial.html).not.toContain("Kicker");
    expect(sourceMaterial.html).toContain(
      "A second paragraph completes the rendered source content.",
    );
  });
}

// A one-pixel PNG, served in place of the publisher's image.
const COVER_IMAGE_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==",
  "base64",
);

test("loads a cover image as a browser navigation carrying the source page as referrer", async ({
  browser: playwrightBrowser,
}) => {
  const sourceUrl = "https://www.gatesnotes.com/a-turbulent-ai-era-and-critical-choices-to-make";
  const coverImageUrl = "https://images.gatesnotes.com/cover.png";
  const requests: Array<{ url: string; referer: string | undefined; accept: string | undefined }> =
    [];
  const browser: CoverImageBrowser = {
    newPage: async ({ javaScriptEnabled }) => {
      const page = await playwrightBrowser.newPage({ javaScriptEnabled });

      return {
        route: (pattern, handler) =>
          page.route(pattern, (route) =>
            handler({
              request: () => route.request(),
              abort: (errorCode) => route.abort(errorCode),
              // The loader approved the request; answer it locally instead of reaching the internet.
              continue: async () => {
                const headers = route.request().headers();
                requests.push({
                  url: route.request().url(),
                  referer: headers["referer"],
                  accept: headers["accept"],
                });
                await route.fulfill({
                  body: COVER_IMAGE_BYTES,
                  // Deliberately wrong: the type must come from the bytes.
                  contentType: "image/jpeg",
                });
              },
            }),
          ),
        context: () => page.context(),
        setExtraHTTPHeaders: (headers) => page.setExtraHTTPHeaders(headers),
        goto: (url, options) => page.goto(url, options),
        close: () => page.close(),
      };
    },
  };

  const result = await loadCoverImage({ browser, declaration: { url: coverImageUrl }, sourceUrl });

  expect(result).toEqual({
    result: "loaded",
    bytes: COVER_IMAGE_BYTES,
    contentType: "image/png",
  });
  expect(requests[0]).toEqual({
    url: coverImageUrl,
    referer: sourceUrl,
    accept: expect.stringContaining("image/avif"),
  });
});

// Retain public page URLs so production URL checks and relative resource resolution still run.
// Only the test transport redirects requests to the local recording server.
function createFixtureBrowser(
  playwrightBrowser: Browser,
  request: APIRequestContext,
  missingRecordings: string[],
): SourceMaterialBrowser {
  const chromiumMajorVersion = playwrightBrowser.version().split(".")[0];
  if (!chromiumMajorVersion) {
    throw new Error("Expected Chromium to report its version");
  }
  const recordedHosts = new Set([
    "www.anthropic.com",
    "blog.cloudflare.com",
    "blog.search.ai.cloudflare.com",
    "www.gatesnotes.com",
    "content.gatesnotes.com",
    "www.derstandard.at",
    "at.staticfiles.at",
    "b.staticfiles.at",
    "developers.openai.com",
    "www.washingtonpost.com",
    "en.wikipedia.org",
  ]);
  const recordedResourceTypes = new Set(["document", "script", "stylesheet", "xhr", "fetch"]);

  return {
    newPage: async ({ javaScriptEnabled }) => {
      const page = await playwrightBrowser.newPage({
        javaScriptEnabled,
        userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromiumMajorVersion}.0.0.0 Safari/537.36`,
        extraHTTPHeaders: {
          "sec-ch-ua": `"Chromium";v="${chromiumMajorVersion}", "Not=A?Brand";v="99"`,
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Linux"',
        },
        locale: "en-GB",
        serviceWorkers: "block",
      });
      return {
        route: (pattern, handler) =>
          page.route(pattern, (route) =>
            handler({
              request: () => route.request(),
              abort: (errorCode) => route.abort(errorCode),
              continue: async () => {
                const sourceRequest = route.request();
                const url = sourceRequest.url();
                // Images, fonts, media, and third-party tracking do not supply narration content.
                if (
                  !recordedHosts.has(new URL(url).hostname) ||
                  !recordedResourceTypes.has(sourceRequest.resourceType())
                ) {
                  await route.abort("blockedbyclient");
                  return;
                }
                const response = await request.get("/resource", { params: { url } });
                if (!response.ok()) {
                  missingRecordings.push(url);
                  await route.abort("blockedbyclient");
                  return;
                }
                await route.fulfill({ response });
              },
            }),
          ),
        context: () => page.context(),
        goto: (url, options) => page.goto(url, options),
        waitForFunction: (pageFunction, argument, options) =>
          page.waitForFunction(pageFunction, argument, options),
        evaluate: (pageFunction, attributeName) => page.evaluate(pageFunction, attributeName),
        locator: (selector) => page.locator(selector),
        title: () => page.title(),
        close: () => page.close(),
      };
    },
  };
}

function extractHeadingTexts(html: string): string[] {
  const headingTexts: string[] = [];
  const collectHeadingTexts = (parentNode: DefaultTreeAdapterMap["parentNode"]) => {
    for (const childNode of parentNode.childNodes) {
      if (!("tagName" in childNode)) {
        continue;
      }

      if (/^h[1-6]$/u.test(childNode.tagName)) {
        headingTexts.push(extractText(childNode).replace(/\s+/gu, " ").trim());
      }
      collectHeadingTexts(childNode);
    }
  };

  collectHeadingTexts(parseFragment(html));

  return headingTexts;
}

function extractText(parentNode: DefaultTreeAdapterMap["parentNode"]): string {
  return parentNode.childNodes
    .map((childNode) => {
      if ("value" in childNode) {
        return childNode.value;
      }

      return "tagName" in childNode ? extractText(childNode) : "";
    })
    .join("");
}

function extractElementById(html: string, elementId: string): string {
  const documentFragment = parseFragment(html);
  const element = findElementById(documentFragment, elementId);

  if (!element) {
    throw new Error(`Expected source material to contain element #${elementId}`);
  }

  return serializeOuter(element);
}

function findElementById(
  parentNode: DefaultTreeAdapterMap["parentNode"],
  elementId: string,
): DefaultTreeAdapterMap["element"] | undefined {
  for (const childNode of parentNode.childNodes) {
    if (!("tagName" in childNode)) {
      continue;
    }

    if (
      childNode.attrs.some((attribute) => attribute.name === "id" && attribute.value === elementId)
    ) {
      return childNode;
    }

    const descendant = findElementById(childNode, elementId);

    if (descendant) {
      return descendant;
    }
  }

  return undefined;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
