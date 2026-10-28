import { expect, test, vi } from "vitest";

import {
  assertPublicSourceUrl,
  type Browser,
  cleanAudiobookSourceMaterialHtml,
  extractCoverImageDeclaration,
  loadPublicSourcePage,
  prepareLoadedSourcePage,
  prepareSourceMaterial,
} from "#src/prepare-source-material.ts";

const SOURCE_URL = "https://publisher.example/story";
const UNUSED_BROWSER = {
  newPage: () => Promise.reject(new Error("The test source-page loader should be used")),
} satisfies Browser;

test("recursively removes empty elements while preserving meaningful leaf elements", () => {
  const sourcePageHtml = `
    <title>Browser title with site suffix</title>
    <main>
      <ad-container>
        <ad-slot></ad-slot>
      </ad-container>
      <div>
        <span> </span>
      </div>
      <script>document.body.dataset.executed = "true";</script>
      <style>.advertisement { display: none; }</style>
      <noscript>Enable JavaScript to continue</noscript>
      <svg><title>Decorative icon</title></svg>
      <figure><img src="chart.jpg" alt="A chart" /></figure>
      <nav><a href="/section">Section navigation</a></nav>
      <form><input name="email" /><button>Subscribe</button></form>
      <h1>The source title</h1>
      <p>Relevant source text</p>
      <div><img src="cover.jpg" alt="Source cover" /></div>
      <footer>Legal information</footer>
    </main>
  `;
  const html = cleanAudiobookSourceMaterialHtml(sourcePageHtml);
  expect(html).not.toContain("ad-container");
  expect(html).not.toContain("ad-slot");
  expect(html).not.toContain("<span");
  expect(html).not.toContain("<script");
  expect(html).not.toContain("<style");
  expect(html).not.toContain("<noscript");
  expect(html).not.toContain("<svg");
  expect(html).not.toContain("<figure");
  expect(html).not.toContain("<nav");
  expect(html).not.toContain("<form");
  expect(html).not.toContain("<input");
  expect(html).not.toContain("<button");
  expect(html).not.toContain("<footer");
  expect(html).not.toContain("chart.jpg");
  expect(html).toContain("<p>Relevant source text</p>");
  expect(html).toContain('<img src="cover.jpg" alt="Source cover">');
});

test("removes comments and role-based page controls while preserving article attributes", () => {
  const html = cleanAudiobookSourceMaterialHtml(
    '<article class="layout"><!-- tracking --><div role="navigation">Home</div><div role="search">Search</div><p class="body" style="color:red">Read <a href="/source" title="Source">this</a>.</p><template><!-- hidden --><nav>Menu</nav><p>Template text</p></template></article>',
  );

  expect(html).toBe(
    '<article class="layout"><p class="body" style="color:red">Read <a href="/source" title="Source">this</a>.</p><template><p>Template text</p></template></article>',
  );
});

test.each([
  "http://127.0.0.1/source",
  "http://10.1.2.3/source",
  "http://169.254.169.254/latest/meta-data",
  "http://[::1]/source",
  "https://metadata.google.internal/",
  "https://service.local/source",
])("blocks non-public source destination %s", (url) => {
  expect(() => assertPublicSourceUrl(url)).toThrow("not public");
});

test("allows a public HTTPS source destination", () => {
  expect(() => assertPublicSourceUrl(SOURCE_URL)).not.toThrow();
});

test("waits for rendered narration content without requiring an h1", async () => {
  let bodyHtml = '<div id="__next"></div>';
  let documentTitle = "";
  const renderedParagraphs = [
    "The first complete source paragraph contains enough narration text to distinguish it from a loading shell.",
    "The second complete paragraph makes the rendered source ready even though this page intentionally has no level-one heading.",
  ] as const;
  let narrationBlocks: Array<{ textContent: string }> = [{ textContent: "Loading source content" }];
  const contentRoot = {
    querySelector: () => narrationBlocks[0],
    querySelectorAll: () =>
      narrationBlocks.map((block) => ({
        ...block,
        closest: () => null,
      })),
  };
  const browser = {
    newPage: () =>
      Promise.resolve({
        route: () => Promise.resolve(),
        context: () => ({ addCookies: () => Promise.resolve() }),
        goto: (_url: string, options: { waitUntil: string }) => {
          if (options.waitUntil !== "domcontentloaded") {
            throw new Error("Background requests did not become idle");
          }

          return Promise.resolve({ status: () => 200 });
        },
        evaluate: async () => {},
        waitForFunction: (pageFunction, options) => {
          documentTitle = "Rendered document | Publisher";
          vi.stubGlobal("document", {
            body: contentRoot,
            querySelector: () => null,
            querySelectorAll: () => [contentRoot],
            title: documentTitle,
          });

          try {
            expect(pageFunction(options)).toBe(false);
            narrationBlocks = renderedParagraphs.map((textContent) => ({ textContent }));
            expect(pageFunction(options)).toBe(true);
            bodyHtml = `<main>${renderedParagraphs.map((paragraph) => `<p>${paragraph}</p>`).join("")}</main>`;
            return Promise.resolve();
          } finally {
            vi.unstubAllGlobals();
          }
        },
        locator: () => ({ innerHTML: () => Promise.resolve(bodyHtml) }),
        title: () => Promise.resolve(documentTitle),
        close: () => Promise.resolve(),
      }),
  } satisfies Browser;

  await expect(
    loadPublicSourcePage({ browser, javaScriptEnabled: true, url: SOURCE_URL }),
  ).resolves.toEqual({
    bodyHtml:
      "<main><p>The first complete source paragraph contains enough narration text to distinguish it from a loading shell.</p><p>The second complete paragraph makes the rendered source ready even though this page intentionally has no level-one heading.</p></main>",
    documentTitle: "Rendered document | Publisher",
    responseStatus: 200,
  });
});

test("takes the source title from the visible headline and cuts the source material there", () => {
  const sourceMaterial = prepareLoadedSourcePage({
    bodyHtml: `<h1 class="hidden">Hidden page heading</h1><main><p class="kicker">Kicker</p><header><a href="/hub">Hub</a><h1 class="title" data-cup-visible-headline>  The visible
      headline </h1><p>Summary line</p></header><p>First paragraph.</p></main>`,
    documentTitle: "Document title | Publisher",
    responseStatus: 200,
  });

  expect(sourceMaterial).toEqual({
    html: "<main><header><p>Summary line</p></header><p>First paragraph.</p></main>",
    title: "The visible headline",
  });
});

test("removes every visible headline mark from the source material", () => {
  const { html } = prepareLoadedSourcePage({
    bodyHtml:
      "<main><h1 data-cup-visible-headline>Visible headline</h1><p>First paragraph.</p><h1 data-cup-visible-headline>Later heading</h1><p>Second paragraph.</p></main>",
    documentTitle: "Document title",
    responseStatus: 200,
  });

  expect(html).toBe(
    "<main><p>First paragraph.</p><h1>Later heading</h1><p>Second paragraph.</p></main>",
  );
});

test("falls back to the document title and cuts nothing without a visible headline", () => {
  const bodyHtml = "<main><p>Kicker</p><h1>Hidden heading</h1><p>First paragraph.</p></main>";

  expect(
    prepareLoadedSourcePage({
      bodyHtml,
      documentTitle: " Document title | Publisher ",
      responseStatus: 200,
    }),
  ).toEqual({
    html: bodyHtml,
    title: "Document title | Publisher",
  });
});

test("uses the JavaScript-rendered source page when the static page has no source content", async () => {
  const javaScriptModes: boolean[] = [];

  const sourceMaterial = await prepareSourceMaterial({
    browser: UNUSED_BROWSER,
    url: SOURCE_URL,
    loadSourcePage: async ({ javaScriptEnabled }) => {
      javaScriptModes.push(javaScriptEnabled);

      return javaScriptEnabled
        ? {
            bodyHtml:
              "<main><h1 data-cup-visible-headline>Rendered document</h1><p>Complete source text.</p></main>",
            documentTitle: "Rendered document | Publisher",
            responseStatus: 200,
          }
        : {
            bodyHtml: '<div id="__next"></div>',
            documentTitle: "",
            responseStatus: 200,
          };
    },
  });

  expect(javaScriptModes).toEqual([false, true]);
  expect(sourceMaterial).toEqual({
    html: "<main><p>Complete source text.</p></main>",
    title: "Rendered document",
  });
});

test("rejects an HTTP error page even when it has an document-style title", async () => {
  await expect(
    prepareSourceMaterial({
      browser: UNUSED_BROWSER,
      url: SOURCE_URL,
      loadSourcePage: async ({ javaScriptEnabled }) =>
        javaScriptEnabled
          ? {
              bodyHtml: "<main><h1>Access Denied</h1><p>Reference number 123.</p></main>",
              documentTitle: "Access Denied",
              responseStatus: 403,
            }
          : {
              bodyHtml: '<div id="__next"></div>',
              documentTitle: "",
              responseStatus: 200,
            },
    }),
  ).rejects.toThrow("Expected the source page to have a title");
});

test("uses the source page with more source content when both loads are usable", async () => {
  const sourceMaterial = await prepareSourceMaterial({
    browser: UNUSED_BROWSER,
    url: SOURCE_URL,
    loadSourcePage: async ({ javaScriptEnabled }) =>
      javaScriptEnabled
        ? {
            bodyHtml:
              "<main><h1 data-cup-visible-headline>Rendered document</h1><p>First paragraph.</p><p>Second paragraph.</p></main>",
            documentTitle: "Rendered document | Publisher",
            responseStatus: 200,
          }
        : {
            bodyHtml:
              "<main><h1 data-cup-visible-headline>Static document</h1><p>Preview.</p></main>",
            documentTitle: "Static document | Publisher",
            responseStatus: 200,
          },
  });

  expect(sourceMaterial).toEqual({
    html: "<main><p>First paragraph.</p><p>Second paragraph.</p></main>",
    title: "Rendered document",
  });
});

test("keeps the static source page when rendering adds only dynamic page chrome", async () => {
  const staticSourceMaterialHtml =
    "<article><p>This complete source paragraph contains enough narration text to make a small dynamic posting count immaterial when the two source pages are compared.</p><ul><li>Open comments</li></ul></article>";
  const staticBodyHtml = staticSourceMaterialHtml.replace(
    "<article>",
    "<article><h1 data-cup-visible-headline>Source title</h1>",
  );
  const sourceMaterial = await prepareSourceMaterial({
    browser: UNUSED_BROWSER,
    url: SOURCE_URL,
    loadSourcePage: async ({ javaScriptEnabled }) => ({
      bodyHtml: javaScriptEnabled
        ? staticBodyHtml.replace("Open comments", "Open comments · 998 postings")
        : staticBodyHtml,
      documentTitle: "Source title | Publisher",
      responseStatus: 200,
    }),
  });

  expect(sourceMaterial).toEqual({
    html: staticSourceMaterialHtml,
    title: "Source title",
  });
});

test("uses the static source page when the JavaScript-enabled load fails", async () => {
  const sourceMaterial = await prepareSourceMaterial({
    browser: UNUSED_BROWSER,
    url: SOURCE_URL,
    loadSourcePage: ({ javaScriptEnabled }) => {
      if (javaScriptEnabled) {
        throw new Error("Rendered page load failed");
      }

      return Promise.resolve({
        bodyHtml:
          "<main><h1 data-cup-visible-headline>Static document</h1><p>Complete source text.</p></main>",
        documentTitle: "Static document | Publisher",
        responseStatus: 200,
      });
    },
  });

  expect(sourceMaterial).toEqual({
    html: "<main><p>Complete source text.</p></main>",
    title: "Static document",
  });
});

test.each([
  undefined,
  [{ name: "consent", value: "yes", domain: ".publisher.example", path: "/" }],
])("installs configured cookies before both source-page navigations: %j", async (cookies) => {
  const modes: boolean[] = [];
  const browser = {
    newPage: async ({ javaScriptEnabled }) => {
      modes.push(javaScriptEnabled);
      let installedCookies: unknown = [];
      return {
        route: async () => {},
        context: () => ({
          addCookies: async (values) => {
            installedCookies = values;
          },
        }),
        goto: async () => {
          expect(installedCookies).toEqual(cookies ?? []);
          return { status: () => 200 };
        },
        evaluate: async () => {},
        waitForFunction: async () => {},
        locator: () => ({ innerHTML: async () => "<p>Source content</p>" }),
        title: async () => "Source title",
        close: async () => {},
      };
    },
  } satisfies Browser;

  await expect(
    prepareSourceMaterial({
      browser,
      url: SOURCE_URL,
      ...(cookies === undefined ? {} : { cookies }),
    }),
  ).resolves.toEqual({ html: "<p>Source content</p>", title: "Source title" });
  expect(modes).toEqual([false, true]);
});

test("prefers the secure Open Graph image and reads its alternative text", () => {
  expect(
    extractCoverImageDeclaration(
      `
        <meta name="twitter:image" content="https://cdn.publisher.example/twitter.jpg" />
        <meta property="og:image" content="http://cdn.publisher.example/cover.jpg" />
        <meta property="og:image:secure_url" content="https://cdn.publisher.example/cover.jpg" />
        <meta property="og:image:alt" content="  A lighthouse   at dusk " />
        <meta property="og:image" content="https://cdn.publisher.example/second.jpg" />
      `,
      SOURCE_URL,
    ),
  ).toEqual({
    url: "https://cdn.publisher.example/cover.jpg",
    alternativeText: "A lighthouse at dusk",
  });
});

test("falls back to the Twitter card image and resolves it against the source page", () => {
  expect(
    extractCoverImageDeclaration(
      '<meta name="twitter:image" content="/images/cover.png"><meta name="twitter:image:alt" content="A chart">',
      SOURCE_URL,
    ),
  ).toEqual({ url: "https://publisher.example/images/cover.png", alternativeText: "A chart" });
});

test("uses only the first Open Graph image's own properties", () => {
  expect(
    extractCoverImageDeclaration(
      `
        <meta property="og:image" content="https://cdn.publisher.example/first.jpg" />
        <meta property="og:image" content="http://cdn.publisher.example/second.jpg" />
        <meta property="og:image:secure_url" content="https://cdn.publisher.example/second.jpg" />
        <meta property="og:image:alt" content="The second image" />
      `,
      SOURCE_URL,
    ),
  ).toEqual({ url: "https://cdn.publisher.example/first.jpg" });
});

test("falls through to the Twitter card image when the Open Graph image is unusable", () => {
  expect(
    extractCoverImageDeclaration(
      `
        <meta property="og:image" content="data:image/png;base64,iVBORw0KGgo=" />
        <meta property="og:image:alt" content="An embedded image" />
        <meta name="twitter:image" content="https://cdn.publisher.example/card.jpg" />
        <meta name="twitter:image:alt" content="A card image" />
      `,
      SOURCE_URL,
    ),
  ).toEqual({ url: "https://cdn.publisher.example/card.jpg", alternativeText: "A card image" });
});

test.each([
  ["no image metadata", '<meta property="og:title" content="A title">'],
  ["an empty declaration", '<meta property="og:image" content=" ">'],
  ["an embedded image", '<meta property="og:image" content="data:image/png;base64,iVBORw0KGgo=">'],
  ["an unparsable URL", '<meta property="og:image" content="https://">'],
  [
    "an oversized URL",
    `<meta property="og:image" content="https://cdn.publisher.example/${"a".repeat(2048)}">`,
  ],
])("declares no cover image for %s", (_description, headHtml) => {
  expect(extractCoverImageDeclaration(headHtml, SOURCE_URL)).toBeUndefined();
});

test("takes the cover image from the rendered load even when the static load wins on text", async () => {
  const sourceMaterial = await prepareSourceMaterial({
    browser: UNUSED_BROWSER,
    url: SOURCE_URL,
    loadSourcePage: async ({ javaScriptEnabled }) => ({
      bodyHtml:
        "<main><h1 data-cup-visible-headline>Source title</h1><p>Complete source text.</p></main>",
      documentTitle: "Source title | Publisher",
      coverImage: {
        url: javaScriptEnabled
          ? "https://cdn.publisher.example/article.jpg"
          : "https://cdn.publisher.example/site-default.jpg",
      },
      responseStatus: 200,
    }),
  });

  expect(sourceMaterial).toEqual({
    html: "<main><p>Complete source text.</p></main>",
    title: "Source title",
    coverImage: { url: "https://cdn.publisher.example/article.jpg" },
  });
});

test("keeps the static load's cover image when the rendered load declares none", async () => {
  const sourceMaterial = await prepareSourceMaterial({
    browser: UNUSED_BROWSER,
    url: SOURCE_URL,
    loadSourcePage: async ({ javaScriptEnabled }) => ({
      bodyHtml:
        "<main><h1 data-cup-visible-headline>Source title</h1><p>Complete source text.</p></main>",
      documentTitle: "Source title | Publisher",
      ...(javaScriptEnabled
        ? {}
        : { coverImage: { url: "https://cdn.publisher.example/static.jpg" } }),
      responseStatus: 200,
    }),
  });

  expect(sourceMaterial.coverImage).toEqual({ url: "https://cdn.publisher.example/static.jpg" });
});

test("reads the cover image declaration from the loaded page's head", async () => {
  const browser = {
    newPage: async () => ({
      route: async () => {},
      context: () => ({ addCookies: async () => {} }),
      goto: async () => ({ status: () => 200 }),
      evaluate: async () => {},
      waitForFunction: async () => {},
      locator: (selector) => ({
        innerHTML: async () =>
          selector === "head"
            ? '<meta property="og:image" content="https://cdn.publisher.example/cover.jpg">'
            : "<p>Source content</p>",
      }),
      title: async () => "Source title",
      close: async () => {},
    }),
  } satisfies Browser;

  await expect(
    loadPublicSourcePage({ browser, javaScriptEnabled: false, url: SOURCE_URL }),
  ).resolves.toEqual({
    bodyHtml: "<p>Source content</p>",
    documentTitle: "Source title",
    coverImage: { url: "https://cdn.publisher.example/cover.jpg" },
    responseStatus: 200,
  });
});
