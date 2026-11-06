import { expect, test } from "@playwright/test";

import { readFidelityCheckEnvironment } from "#fidelity-check/inputs.ts";

import { checkAgainstDesign, formatFidelityReport, readDesignImageSize } from "@cup/fidelity-check";

const { story, designImagePath, ignoreTopPixels } = readFidelityCheckEnvironment(
  // oxlint-disable-next-line node/no-process-env -- The inputs cli.ts checked; this run has no other way to get them.
  process.env,
);

// 3x as on a phone: text at 1x snaps to whole pixels, unlike the design's render.
test.use({ viewport: readDesignImageSize(designImagePath), deviceScaleFactor: 3 });

test(`${story} matches the design`, async ({ mount, page }) => {
  await mount(story);
  // A route story renders only after its lazily loaded chunk arrives, some time after mounting.
  await expect(page.getByRole("main")).toBeVisible();

  const report = await checkAgainstDesign(page, {
    designImagePath,
    reportDirectory: "playwright-output/fidelity-check",
    ignoreTopPixels,
  });

  // The report also has to reach a run whose bands all match, for its fonts and colors.
  console.log(formatFidelityReport(report));
  expect(report.bands.filter(({ isWithinTolerance }) => !isWithinTolerance)).toEqual([]);
});
