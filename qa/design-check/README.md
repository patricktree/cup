# Design check

Compares a rendered screen with the design's image (`@cup/design-check`). Screenshot baselines are written from the implementation, so they guard against regressions but say nothing about the design; this check is what does.

Save the design's render as a PNG at 1x, such as the screenshot Figma's `get_design_context` returns, and name a story:

```sh
DESIGN_CHECK_STORY=routes/index/LandingPage \
DESIGN_CHECK_IMAGE=/absolute/path/to/design.png \
DESIGN_CHECK_IGNORE_TOP=55 \
pnpm --filter '@cup/web-app' design-check
```

`DESIGN_CHECK_IGNORE_TOP` skips rows the app does not draw, such as a device status bar in the design. The run renders at the image's size and needs Docker like the other Playwright suites. Its files land in `apps/web-app/playwright-output/design-check`: `report.json`, `rendered.png`, and `overlay.png`, which is dark where both images have ink, red for the design alone, and blue for the screen alone.

The run prints two sections, and only the first can fail it:

- **Bands** are the rows of ink each image has, compared by their edges. A band further than 1 px from the design fails the run. An element inside a band can be off without moving the band's edges, so read the overlay too.
- **Elements** lists the box, font, color and opacity of every drawn element. The design's image cannot supply these, so compare them with the design's values by hand.

The story is rendered in its first state, so a state the design shows differently, such as a disabled button it draws enabled, shows up as a difference to judge rather than to fix. Text widths can also differ slightly between the design tool and the browser.
