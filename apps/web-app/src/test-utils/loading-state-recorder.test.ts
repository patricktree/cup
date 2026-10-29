import { expect, test, type Page } from "@playwright/test";

import {
  readLoadingStateRecord,
  recordLoadingStates,
} from "#src/test-utils/loading-state-recorder.ts";

const PAGE_URL = "http://loading-state-recorder.test/";

/** Serves `script` on a page of its own, so the recorder is tested apart from the app. */
async function openPageRunning(page: Page, script: string) {
  await page.route(PAGE_URL, (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><body><main></main><script>${script}</script></body></html>`,
    }),
  );
  await page.goto(PAGE_URL);
  await expect(page.locator("main")).toHaveAttribute("data-done", "");
}

test("records a loading state inserted and removed within one task", async ({ page }) => {
  await recordLoadingStates(page);

  await openPageRunning(
    page,
    `
      const main = document.querySelector("main");
      const loading = document.createElement("output");
      loading.setAttribute("data-loading-state", "");
      loading.textContent = "Loading tracks…";
      main.append(loading);
      loading.remove();
      main.setAttribute("data-done", "");
    `,
  );

  expect(await readLoadingStateRecord(page)).toEqual([
    { marker: "data-loading-state", name: "Loading tracks…", at: expect.any(Number) },
  ]);
});

test("records a marked element nested inside an added subtree", async ({ page }) => {
  await recordLoadingStates(page);

  await openPageRunning(
    page,
    `
      const main = document.querySelector("main");
      const screen = document.createElement("div");
      screen.innerHTML =
        '<section><div data-pending-signal></div><section data-loading-state aria-label="Loading track"></section></section>';
      main.append(screen);
      main.setAttribute("data-done", "");
    `,
  );

  expect(await readLoadingStateRecord(page)).toEqual([
    { marker: "data-pending-signal", name: "", at: expect.any(Number) },
    { marker: "data-loading-state", name: "Loading track", at: expect.any(Number) },
  ]);
});

test("records a marked element once when its ancestors are added in the same task", async ({
  page,
}) => {
  await recordLoadingStates(page);

  await openPageRunning(
    page,
    `
      const main = document.querySelector("main");
      const screen = document.createElement("div");
      const section = document.createElement("section");
      const loading = document.createElement("output");
      loading.setAttribute("data-loading-state", "");
      loading.textContent = "Loading account…";
      main.append(screen);
      screen.append(section);
      section.append(loading);
      main.setAttribute("data-done", "");
    `,
  );

  expect(await readLoadingStateRecord(page)).toEqual([
    { marker: "data-loading-state", name: "Loading account…", at: expect.any(Number) },
  ]);
});

test("records a marked element again when it is inserted again later", async ({ page }) => {
  await recordLoadingStates(page);

  await openPageRunning(
    page,
    `
      const main = document.querySelector("main");
      const loading = document.createElement("output");
      loading.setAttribute("data-loading-state", "");
      loading.textContent = "Loading tracks…";
      main.append(loading);
      setTimeout(() => {
        loading.remove();
        setTimeout(() => {
          main.append(loading);
          setTimeout(() => main.setAttribute("data-done", ""));
        });
      });
    `,
  );

  expect(await readLoadingStateRecord(page)).toEqual([
    { marker: "data-loading-state", name: "Loading tracks…", at: expect.any(Number) },
    { marker: "data-loading-state", name: "Loading tracks…", at: expect.any(Number) },
  ]);
});

test("records nothing for content without a marker", async ({ page }) => {
  await recordLoadingStates(page);

  await openPageRunning(
    page,
    `
      const main = document.querySelector("main");
      const card = document.createElement("article");
      card.innerHTML = '<img data-loading alt=""><h2>A track</h2>';
      main.append(card);
      main.setAttribute("data-done", "");
    `,
  );

  expect(await readLoadingStateRecord(page)).toEqual([]);
});
