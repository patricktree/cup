import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import {
  checkAgainstDesign,
  formatDesignCheckReport,
  readDesignImageSize,
} from "#src/design-check.ts";

const FONT_URL = "http://design-check.test/font.woff2";
const VIEWPORT = { width: 200, height: 300 };
const BOXES = [
  { x: 20, y: 40, width: 100, height: 30 },
  { x: 20, y: 120, width: 160, height: 50 },
];

test.use({ viewport: VIEWPORT, deviceScaleFactor: 3 });

function showBoxes(page: Page, boxes: typeof BOXES) {
  const elements = boxes
    .map(
      ({ x, y, width, height }) =>
        `<div style="position:absolute;left:${x}px;top:${y}px;width:${width}px;height:${height}px;background:#121212"></div>`,
    )
    .join("");
  return page.setContent(
    `<!doctype html><html><body style="margin:0;background:#f6f6f3">${elements}<p style="position:absolute;top:250px;margin:0;font:400 18px/32px sans-serif;color:#f6f6f3">Label</p></body></html>`,
  );
}

/** Stands in for a design tool's render: one image pixel per design pixel. */
async function renderDesignImage(browser: Browser, testInfo: TestInfo): Promise<string> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await showBoxes(page, BOXES);
  const designImagePath = testInfo.outputPath("design.png");
  await page.screenshot({ path: designImagePath });
  await context.close();
  return designImagePath;
}

test("reads the viewport from the design image", async ({ browser }, testInfo) => {
  expect(readDesignImageSize(await renderDesignImage(browser, testInfo))).toEqual(VIEWPORT);
});

test("reports a font that was still loading when the check started", async ({
  browser,
  page,
}, testInfo) => {
  const designImagePath = await renderDesignImage(browser, testInfo);
  const font = fs.readFileSync(
    fileURLToPath(
      import.meta.resolve("@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"),
    ),
  );
  await page.route(FONT_URL, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({
      body: font,
      contentType: "font/woff2",
      headers: { "access-control-allow-origin": "*" },
    });
  });
  await showBoxes(page, BOXES);
  // Added after `setContent`, which would otherwise wait for the font through the load event.
  await page.addStyleTag({
    content: `@font-face { font-family: DelayedFont; src: url("${FONT_URL}"); } p { font-family: DelayedFont !important; }`,
  });

  const report = await checkAgainstDesign(page, {
    designImagePath,
    reportDirectory: testInfo.outputPath("report"),
  });

  expect(report.loadedFonts).toEqual(["DelayedFont normal"]);
});

test("rejects a comparison that finds no ink in the design", async ({
  browser,
  page,
}, testInfo) => {
  const designImagePath = await renderDesignImage(browser, testInfo);
  await showBoxes(page, BOXES);

  await expect(
    checkAgainstDesign(page, {
      designImagePath,
      reportDirectory: testInfo.outputPath("report"),
      ignoreTopPixels: VIEWPORT.height,
    }),
  ).rejects.toThrow("found no ink in the design");
});

test("rejects a page rendered at another size than the design", async ({
  browser,
  page,
}, testInfo) => {
  const designImagePath = await renderDesignImage(browser, testInfo);
  await page.setViewportSize({ width: VIEWPORT.width + 10, height: VIEWPORT.height });
  await showBoxes(page, BOXES);

  await expect(
    checkAgainstDesign(page, {
      designImagePath,
      reportDirectory: testInfo.outputPath("report"),
    }),
  ).rejects.toThrow("must render at the design image's size");
});

test("rejects a design image with a transparent corner", async ({ browser, page }, testInfo) => {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const designPage = await context.newPage();
  await designPage.setContent(
    `<!doctype html><html><body style="margin:0;background:transparent"><div style="width:50px;height:50px;background:#121212"></div></body></html>`,
  );
  const designImagePath = testInfo.outputPath("design.png");
  await designPage.screenshot({ path: designImagePath, omitBackground: true });
  await context.close();
  await showBoxes(page, BOXES);

  await expect(
    checkAgainstDesign(page, {
      designImagePath,
      reportDirectory: testInfo.outputPath("report"),
    }),
  ).rejects.toThrow("corner must show the background");
});

test("rejects a design image that is not a PNG", () => {
  const notAPng = test.info().outputPath("design.jpg");
  fs.writeFileSync(notAPng, "not a png");

  expect(() => readDesignImageSize(notAPng)).toThrow("must be a PNG");
});

test("finds a page that matches the design within tolerance", async ({
  browser,
  page,
}, testInfo) => {
  const designImagePath = await renderDesignImage(browser, testInfo);
  await showBoxes(page, BOXES);

  const report = await checkAgainstDesign(page, {
    designImagePath,
    reportDirectory: testInfo.outputPath("report"),
  });

  expect(report.bands.map(({ isWithinTolerance }) => isWithinTolerance)).toEqual([true, true]);
  expect(report.bands[0]?.rendered).toEqual({ top: 40, bottom: 69, left: 20, right: 119 });
  expect(report.differingPixelRatio).toBe(0);
});

test("reports a band more than the tolerance away from the design", async ({
  browser,
  page,
}, testInfo) => {
  const designImagePath = await renderDesignImage(browser, testInfo);
  await showBoxes(page, [
    { x: 20, y: 40, width: 100, height: 30 },
    { x: 20, y: 122, width: 160, height: 50 },
  ]);

  const report = await checkAgainstDesign(page, {
    designImagePath,
    reportDirectory: testInfo.outputPath("report"),
  });

  expect(report.bands.map(({ isWithinTolerance }) => isWithinTolerance)).toEqual([true, false]);
  expect(formatDesignCheckReport(report)).toContain(
    "MISMATCH y=120–169 x=20–179 → y=122–171 x=20–179",
  );
});

test("reports an element that the page does not draw", async ({ browser, page }, testInfo) => {
  const designImagePath = await renderDesignImage(browser, testInfo);
  await showBoxes(page, BOXES.slice(0, 1));

  const report = await checkAgainstDesign(page, {
    designImagePath,
    reportDirectory: testInfo.outputPath("report"),
  });

  expect(report.bands[1]).toEqual({
    design: { top: 120, bottom: 169, left: 20, right: 179 },
    rendered: undefined,
    isWithinTolerance: false,
  });
});

test("skips the rows above the ignored height", async ({ browser, page }, testInfo) => {
  const designImagePath = await renderDesignImage(browser, testInfo);
  await showBoxes(page, BOXES.slice(1));

  const report = await checkAgainstDesign(page, {
    designImagePath,
    reportDirectory: testInfo.outputPath("report"),
    ignoreTopPixels: 100,
  });

  expect(report.bands.map(({ isWithinTolerance }) => isWithinTolerance)).toEqual([true]);
  expect(report.differingPixelRatio).toBe(0);
});

test("measures an element's font, color and box and writes the report's files", async ({
  browser,
  page,
}, testInfo) => {
  const designImagePath = await renderDesignImage(browser, testInfo);
  await showBoxes(page, BOXES);
  const reportDirectory = testInfo.outputPath("report");

  const report = await checkAgainstDesign(page, { designImagePath, reportDirectory });

  expect(report.elements).toEqual([
    expect.objectContaining({
      tag: "p",
      label: "Label",
      fontSize: "18px",
      fontWeight: "400",
      lineHeight: "32px",
      color: "rgb(246, 246, 243)",
    }),
  ]);
  expect(fs.readdirSync(reportDirectory).toSorted()).toEqual([
    "overlay.png",
    "rendered.png",
    "report.json",
  ]);
});
