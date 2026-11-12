import type { Page, Route } from "@playwright/test";

import { VISUAL_TAG } from "#test-e2e/browser-project-tags.ts";
import { expect, gotoPage, test } from "#test-e2e/fixtures.ts";

const GRANT_ID = "b4ad28a8-bbd7-46af-a17c-59527becd745";
const CREDENTIAL = `v1.${"a".repeat(43)}`;

// The web app component tests cover the other trial, conversion and track states against their
// stories; this screenshot shows the open Trial in the production build.
test(
  "shows the open trial URL input screen",
  { tag: VISUAL_TAG },
  async ({ page, workerEnvironment }) => {
    await mockCredentialExchange(page, workerEnvironment.origin);
    await gotoPage(page, trialLink(workerEnvironment.origin));

    await expect(page.getByRole("heading", { name: "Just Listen." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Listen" })).toBeDisabled();
    await expect(page).toHaveScreenshot("initial.png");
  },
);

function createGrant(): Record<string, unknown> {
  return {
    grantId: GRANT_ID,
    createdAt: "2026-08-28T10:00:00Z",
    expiresAt: "2026-11-26T10:00:00Z",
    state: "open",
    duration: { availableMilliseconds: 7_200_000, reservedMilliseconds: 0, spentMilliseconds: 0 },
  };
}

async function mockCredentialExchange(page: Page, origin: string): Promise<void> {
  await page.route(`${origin}/api/grants/${GRANT_ID}/sessions`, async (route) => {
    await fulfillJson(route, 201, createGrant());
  });
  await page.route(`${origin}/api/grants/${GRANT_ID}`, async (route) => {
    await fulfillJson(route, 200, createGrant());
  });
}

async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function trialLink(origin: string): string {
  return `${origin}/app/trials/${GRANT_ID}#credential=${CREDENTIAL}`;
}
