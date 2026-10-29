import { expect, test } from "@playwright/test";

for (const state of [
  { story: "routes/account-recovery/SignedOut", text: "Continue with Google", name: "signed-out" },
  {
    story: "routes/account-recovery/DeletionScheduled",
    text: "Restore account…",
    name: "deletion-scheduled",
  },
  {
    story: "routes/account-recovery/ConfirmRecovery",
    text: "Confirm recovery",
    name: "confirm-recovery",
  },
]) {
  test(`renders ${state.name}`, async ({ mount, page }) => {
    const component = await mount(state.story);
    await expect(component.getByText(state.text, { exact: true })).toBeVisible();
    await expect(page).toHaveScreenshot(`${state.name}.png`);
  });
}

test("the page shows no account chrome", async ({ mount, page }) => {
  const component = await mount("routes/account-recovery/SignedOut");
  await expect(component.getByRole("heading", { name: "Restore your account" })).toBeVisible();

  await expect(page.getByRole("navigation", { name: "Tabs" })).toHaveCount(0);
});

test("an active account has nothing to restore and is sent to Recents", async ({ mount }) => {
  const component = await mount("routes/account-recovery/ActiveAccount");
  await expect(component.getByText("This account is not scheduled for deletion.")).toBeVisible();
  await expect(component.getByRole("button", { name: "Delete account…" })).toHaveCount(0);

  await component.getByRole("link", { name: "Go to Recent" }).click();
  await expect(component.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();
});

test("a deletion left unconfirmed in the account dialog is not offered for confirmation", async ({
  mount,
}) => {
  const component = await mount("routes/account-recovery/LeftoverDeletionChallenge");
  await expect(component.getByRole("button", { name: "Restore account…" })).toBeVisible();

  await expect(component.getByRole("button", { name: "Schedule deletion" })).toHaveCount(0);
  await expect(component.getByRole("region", { name: "Confirm account change" })).toHaveCount(0);
});

test("the account still loading is marked as a loading state", async ({ mount }) => {
  const component = await mount("routes/account-recovery/LoadingAccount");

  await expect(component.getByText("Loading account…")).toHaveAttribute("data-loading-state", "");
});
