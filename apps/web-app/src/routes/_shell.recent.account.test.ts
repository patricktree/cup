import { expect, test } from "@playwright/test";

import { ACCOUNT_CONFIRMATION_STORAGE_KEY } from "#src/data-fetching/account-confirmation-storage.ts";

for (const state of [
  {
    story: "routes/_shell.recent.account/ActiveAccount",
    text: "Delete account…",
    name: "active-account",
  },
  {
    story: "routes/_shell.recent.account/SetupPending",
    text: "Retry setup",
    name: "setup-pending",
  },
  {
    story: "routes/_shell.recent.account/ConfirmDeletion",
    text: "Schedule deletion",
    name: "confirm-deletion",
  },
  {
    story: "routes/_shell.recent.account/RecoveryAvailable",
    text: "Restore account…",
    name: "recovery-available",
  },
  {
    story: "routes/_shell.recent.account/ConfirmRecovery",
    text: "Confirm recovery",
    name: "confirm-recovery",
  },
  {
    story: "routes/_shell.recent.account/FinalDeletion",
    text: "Restore account…",
    name: "final-deletion",
  },
]) {
  test(`renders ${state.name}`, async ({ mount, page }) => {
    await mount(state.story);
    const dialog = page.getByRole("dialog", { name: "Account settings" });
    await expect(dialog.getByText(state.text, { exact: true })).toBeVisible();
    if (state.name === "final-deletion") {
      await expect(dialog.getByRole("button", { name: "Restore account…" })).toBeDisabled();
    }
    await expect(page).toHaveScreenshot(`${state.name}.png`);
  });
}

test("closing the account dialog opened from Recents returns to Recents", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/_shell.recent/EmptyRecents");
  await component.getByRole("link", { name: "Account", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Account settings" });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(component.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();
  // Opening again proves closing went back to the entry below, not forward to a new one.
  await component.getByRole("link", { name: "Account", exact: true }).click();
  await expect(dialog).toBeVisible();
});

test("closing the account dialog opened by a direct link leads to Recents", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/_shell.recent.account/ActiveAccount");
  const dialog = page.getByRole("dialog", { name: "Account settings" });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(component.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();
});

test("canceling deletion confirmation removes the pending operation", async ({ mount, page }) => {
  await mount("routes/_shell.recent.account/ConfirmDeletion");
  const dialog = page.getByRole("dialog", { name: "Account settings" });
  await expect(dialog.getByRole("region", { name: "Confirm account change" })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog.getByRole("region", { name: "Confirm account change" })).not.toBeVisible();
  await expect(dialog).toBeVisible();
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), ACCOUNT_CONFIRMATION_STORAGE_KEY),
  ).toBeNull();
});

test("account setup query failure can be retried", async ({ mount, page }) => {
  await mount("routes/_shell.recent.account/SetupRecovers");
  const dialog = page.getByRole("dialog", { name: "Account settings" });
  await dialog.getByRole("button", { name: "Retry setup" }).click();
  await expect(dialog.getByRole("button", { name: "Delete account…" })).toBeVisible();
});

test("confirmation cannot use a challenge that was cleared after the dialog rendered", async ({
  mount,
  page,
}) => {
  await mount("routes/_shell.recent.account/ConfirmDeletion");
  const dialog = page.getByRole("dialog", { name: "Account settings" });
  await expect(dialog.getByRole("button", { name: "Schedule deletion" })).toBeVisible();
  await page.evaluate((key) => sessionStorage.removeItem(key), ACCOUNT_CONFIRMATION_STORAGE_KEY);
  let deletionRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/account/deletion"
    ) {
      deletionRequests += 1;
    }
  });
  await dialog.getByRole("button", { name: "Schedule deletion" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Use the same Google account that requested confirmation.",
  );
  expect(deletionRequests).toBe(0);
});

test("the account dialog stays open while a confirmation step runs", async ({ mount, page }) => {
  await mount("routes/_shell.recent.account/ConfirmDeletionPending");
  const dialog = page.getByRole("dialog", { name: "Account settings" });
  await dialog.getByRole("button", { name: "Schedule deletion" }).click();
  await expect(dialog.getByText("Working…")).toBeVisible();

  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
});

test("the account still loading is marked as a loading state", async ({ mount, page }) => {
  await mount("routes/_shell.recent.account/LoadingAccount");

  const dialog = page.getByRole("dialog", { name: "Account settings" });
  await expect(dialog.getByText("Loading account…")).toHaveAttribute("data-loading-state", "");
});
