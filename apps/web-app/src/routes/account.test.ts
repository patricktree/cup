import { expect, test } from "@playwright/test";

import { ACCOUNT_CONFIRMATION_STORAGE_KEY } from "#src/data-fetching/account-confirmation-storage.ts";

for (const state of [
  { story: "routes/account/ActiveAccount", text: "Delete account…", name: "active-account" },
  { story: "routes/account/SetupPending", text: "Retry setup", name: "setup-pending" },
  { story: "routes/account/ConfirmDeletion", text: "Schedule deletion", name: "confirm-deletion" },
  {
    story: "routes/account/RecoveryAvailable",
    text: "Restore account…",
    name: "recovery-available",
  },
  { story: "routes/account/ConfirmRecovery", text: "Confirm recovery", name: "confirm-recovery" },
  { story: "routes/account/FinalDeletion", text: "Restore account…", name: "final-deletion" },
]) {
  test(`renders ${state.name}`, async ({ mount }) => {
    const component = await mount(state.story);
    await expect(component.getByText(state.text, { exact: true })).toBeVisible();
    if (state.name === "final-deletion")
      await expect(component.getByRole("button", { name: "Restore account…" })).toBeDisabled();
    await expect(component).toHaveScreenshot(`${state.name}.png`);
  });
}

test("canceling deletion confirmation removes the pending operation", async ({ mount, page }) => {
  const component = await mount("routes/account/ConfirmDeletion");
  await expect(component.getByRole("region", { name: "Confirm account change" })).toBeVisible();
  await component.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(component.getByRole("region", { name: "Confirm account change" })).not.toBeVisible();
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), ACCOUNT_CONFIRMATION_STORAGE_KEY),
  ).toBeNull();
});

test("account setup query failure can be retried", async ({ mount }) => {
  const component = await mount("routes/account/SetupRecovers");
  await component.getByRole("button", { name: "Retry setup" }).click();
  await expect(component.getByRole("button", { name: "Delete account…" })).toBeVisible();
});

test("confirmation cannot use a challenge that was cleared after the page rendered", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/account/ConfirmDeletion");
  await expect(component.getByRole("button", { name: "Schedule deletion" })).toBeVisible();
  await page.evaluate((key) => sessionStorage.removeItem(key), ACCOUNT_CONFIRMATION_STORAGE_KEY);
  let deletionRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/account/deletion")
      deletionRequests += 1;
  });
  await component.getByRole("button", { name: "Schedule deletion" }).click();
  await expect(component.getByRole("alert")).toHaveText(
    "Use the same Google account that requested confirmation.",
  );
  expect(deletionRequests).toBe(0);
});
