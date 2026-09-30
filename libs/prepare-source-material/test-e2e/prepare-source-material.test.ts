import { expect, test } from "@playwright/test";
import type { APIRequestContext, Browser } from "@playwright/test";
import { format } from "oxfmt";
import { parseFragment, serializeOuter } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";

import {
  type Browser as SourceMaterialBrowser,
  prepareSourceMaterial,
  loadPublicSourcePage,
} from "#src/prepare-source-material.ts";

const SOURCE_PAGES = [
  {
    snapshotFilename: "anthropic.html",
    stabilizeSourceMaterial: (html: string) =>
      html.replace(
        /http:\/\/claude\.ai\/redirect\/website\.v1\.[^"]+/g,
        "http://claude.ai/redirect/[redirect-id]",
      ),
    url: "https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents",
  },
  {
    snapshotFilename: "cloudflare.html",
    stabilizeSourceMaterial: (html: string) => html,
    url: "https://blog.cloudflare.com/kitesurf/",
  },
  {
    snapshotFilename: "gates-notes.html",
    stabilizeSourceMaterial: (html: string) =>
      extractElementById(html, "a_turbulent_ai_era_and_critical_choices_to_make_a").replace(
        /(published <span class="ArtDateTime">)[^<]+(<\/span>)/,
        "$1[relative publication date]$2",
      ),
    url: "https://www.gatesnotes.com/a-turbulent-ai-era-and-critical-choices-to-make",
  },
] as const;

for (const { snapshotFilename, stabilizeSourceMaterial, url } of SOURCE_PAGES) {
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
    }

    const sourceMaterial = await prepareSourceMaterial({ browser, url });
    const fullHtml = `<html><head><title>${escapeHtml(sourceMaterial.title)}</title></head><body>${sourceMaterial.html}</body></html>`;
    const stableFullHtml = stabilizeSourceMaterial(fullHtml);
    const { code: formattedFullHtml } = await format(snapshotFilename, stableFullHtml);

    expect(missingRecordings).toEqual([]);
    expect(formattedFullHtml).toMatchSnapshot(snapshotFilename);
  });
}

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
