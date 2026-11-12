---
status: accepted
---

# Run only visual component tests in all four browser projects

The web app component tests ran every test in four Playwright projects, Chromium and WebKit each on a desktop and a mobile device, so that the screenshots cover both engines and both viewports. Most tests assert no screenshot: in the run of 2026-11-12, 1,112 of 1,372 test runs (1,360 s of 1,816 s test time) repeated a behaviour check four times, and the suite took about 7 min 40 s of the uncached review gate ([redundant tests research](https://github.com/patricktree/cup/issues/300)). The map [patricktree/cup#295](https://github.com/patricktree/cup/issues/295) decided the change, the spec [#303](https://github.com/patricktree/cup/issues/303) described it, and [#306](https://github.com/patricktree/cup/issues/306) built it.

## Decision

- **Visual tests run in all four projects; every other test runs in desktop Chromium and mobile WebKit.** A visual test carries the Playwright tag `@visual`. Desktop Chromium and mobile WebKit run every test, so each behaviour still meets both engines and both viewports; mobile Chromium and desktop WebKit run only `@visual` tests (`grep` in [`playwright.config.ts`](../../apps/web-app/playwright.config.ts)).
- **A test is visual when it asserts a screenshot or its behaviour depends on the engine or the viewport**: view transitions, pointer and touch input, layout against the viewport (overflow, the sheet's geometry, the masonry, scrolling), and playback of the narration track, whose `data:` URL is a WebKit workaround ([web app README](../../apps/web-app/README.md#component-tests-and-visual-coverage)). A test is never dropped from a project for repeating its check there when the check depends on the engine or viewport.
- **A screenshot assertion in an untagged test fails.** Component tests import `test` and `expect` from [`src/test-utils/component-test.ts`](../../apps/web-app/src/test-utils/component-test.ts), whose `toHaveScreenshot` fails with a message naming the tag when the test lacks it; lint forbids importing them from `@playwright/test` in test files. Visual coverage therefore cannot shrink by forgetting the tag.

## Considered options

- **Run untagged tests in one project.** Rejected: one engine would then never see most behaviour, and engine bugs outside rendering (media, focus, storage) would go unnoticed.
- **Mark the behaviour-only tests instead of the visual ones.** Rejected: an unmarked test would then default to four projects, and nothing would stop a screenshot from landing in a test marked as behaviour-only.
- **Choose projects per file.** Rejected: most files mix screenshot tests with behaviour tests, so per-file projects would either keep the repetition or lose screenshots.

## Consequences

- The tag is a judgement for engine- and viewport-dependent tests without a screenshot; the README lists the kinds, and reviewers check new tests against it. A behaviour that turns out to differ by engine in a two-project test is still caught in one engine and one viewport, never in neither.
- A screenshot baseline exists for all four projects of every visual test, and for no other test.
