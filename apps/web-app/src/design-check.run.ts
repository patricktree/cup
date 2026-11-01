import { expect, test } from "@playwright/test";

import {
  checkAgainstDesign,
  formatDesignCheckReport,
  readDesignImageSize,
} from "@cup/design-check";

/* oxlint-disable node/no-process-env -- The command's inputs: this run has no other way to get them. */
const story = process.env["DESIGN_CHECK_STORY"];
const designImagePath = process.env["DESIGN_CHECK_IMAGE"];
const ignoreTopPixels = Number(process.env["DESIGN_CHECK_IGNORE_TOP"] ?? 0);
/* oxlint-enable node/no-process-env */

if (story === undefined || designImagePath === undefined) {
  throw new Error(
    "Set DESIGN_CHECK_STORY (such as routes/index/LandingPage) and DESIGN_CHECK_IMAGE (the absolute path of the design's PNG at 1x).",
  );
}

// 3x as on a phone: text at 1x snaps to whole pixels, unlike the design's render.
test.use({ viewport: readDesignImageSize(designImagePath), deviceScaleFactor: 3 });

test(`${story} matches the design`, async ({ mount, page }) => {
  await mount(story);
  // A route story renders only after its lazily loaded chunk arrives, some time after mounting.
  await expect(page.getByRole("main")).toBeVisible();

  const report = await checkAgainstDesign(page, {
    designImagePath,
    reportDirectory: "playwright-output/design-check",
    ignoreTopPixels,
  });

  // The report also has to reach a run whose bands all match, for its fonts and colors.
  console.log(formatDesignCheckReport(report));
  expect(report.bands.filter(({ isWithinTolerance }) => !isWithinTolerance)).toEqual([]);
});
