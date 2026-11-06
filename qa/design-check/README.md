# Design check

Compares a rendered screen with the design's image (`@cup/design-check`). Screenshot baselines are written from the implementation, so they guard against regressions but say nothing about the design; this check is what does.

Save the design's render as a PNG at 1x, such as the screenshot Figma's `get_screenshot` returns, and name a story:

```sh
pnpm --filter '@cup/web-app' design-check --story routes/index/LandingPage --image path/to/design.png --ignore-top 55
```

A relative `--image` path starts from the directory the command is typed in. `--ignore-top` skips rows the app does not draw, such as a device status bar in the design, and `--help` lists the options. The command ([`design-check.cli.ts`](../../apps/web-app/src/design-check.cli.ts)) checks them, then starts the Playwright run and exits with its code. The run renders at the image's size and needs Docker like the other Playwright suites. Its files land in `apps/web-app/playwright-output/design-check`: `report.json`, `rendered.png`, and `overlay.png`, which is dark where both images have ink, red for the design alone, and blue for the screen alone.

The run prints the share of noticeably differing pixels, which text edges keep above zero, and two sections. Only the first can fail it:

- **Bands** are the rows of ink each image has, compared by their edges. An edge further than 1 px from the design fails the run, and it stops with an error when the design image shows no ink at all.
- **Elements** lists the box, font, color and opacity of each input, button, SVG and element with its own text. The design's image cannot supply these, so compare them with the design's values by hand.

A pass does not show a match on its own, so read the numbers and the overlay too:

- **Inside the tolerance:** a band 1 px off prints `ok`. Compare the numbers when exact placement matters.
- **Inside a band:** an element can be off without moving its band's edges, and a surface that spans a row merges its contents into one band.
- **Pale surfaces:** ink means a color clearly apart from the design's bottom right corner, which must show the background. A hairline or a pale card may not count, and neither image shows it as ink.
- **Paired by position:** bands pair in order from the top, so one extra or missing band makes every later pair report a mismatch.

The story must have a `main` landmark, and it is compared in the state it renders first, once `main` is visible. A screen still loading its data is compared as it is, so give the state to compare a story of its own that reaches it. A difference the design draws on purpose, such as a disabled button it draws enabled, also shows up. It can fail the run, as can text widths that differ between the design tool and the browser, so judge a failure before fixing it.
