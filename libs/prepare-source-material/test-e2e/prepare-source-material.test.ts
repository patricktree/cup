import { expect, test } from "@playwright/test";
import type { APIRequestContext, Browser } from "@playwright/test";
import { format } from "oxfmt";
import { parseFragment, serializeOuter } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";

import { type CoverImageBrowser, loadCoverImage } from "#src/load-cover-image.ts";
import {
  type Browser as SourceMaterialBrowser,
  prepareSourceMaterial,
  loadPublicSourcePage,
} from "#src/prepare-source-material.ts";

const SOURCE_PAGES = [
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
    url: "https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents",
  },
  {
    coverImage: {
      url: "https://blog.cloudflare.com/_emdash/api/media/file/01KZBWYMKT77FDVB07PHA3R5WM.png",
    },
    snapshotFilename: "cloudflare.html",
    stabilizeSourceMaterial: (html: string) => html,
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
    url: "https://www.gatesnotes.com/a-turbulent-ai-era-and-critical-choices-to-make",
  },
] as const;

for (const { coverImage, snapshotFilename, stabilizeSourceMaterial, url } of SOURCE_PAGES) {
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

    expect(missingRecordings).toEqual([]);
    expect(sourceMaterial.coverImage).toEqual(coverImage);
    expect(formattedFullHtml).toMatchSnapshot(snapshotFilename);
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
        locator: (selector) => page.locator(selector),
        title: () => page.title(),
        close: () => page.close(),
      };
    },
  };
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
