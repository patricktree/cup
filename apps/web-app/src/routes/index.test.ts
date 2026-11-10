import { expect, test } from "@playwright/test";

import { holdResponses } from "#src/test-utils/held-responses.ts";

test("renders landing", async ({ mount }) => {
  const component = await mount("routes/index/LandingPage");
  await expect(component.getByRole("heading", { name: "Just listen." })).toBeVisible();
  await expect(component.getByText("No reading lists,")).toBeVisible();
  await expect(component.getByRole("textbox", { name: "URL" })).toHaveAttribute(
    "placeholder",
    "Paste website link (https://...)",
  );
  await expect(component.getByText("Already listening with Cup?")).toBeVisible();
  await expect(component.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await expect(component).toHaveScreenshot("landing.png");
});

test("a signed-in listener whose start is pending on home sees no sign-in line", async ({
  mount,
}) => {
  const component = await mount("routes/index/SignedInHomeWithPendingStart");
  await expect(component.getByRole("textbox", { name: "URL" })).toHaveValue(
    "https://example.com/article",
  );
  await expect(component.getByRole("button", { name: "Listen" })).toBeDisabled();
  await expect(component.getByText("Already listening with Cup?")).toHaveCount(0);
  await expect(component.getByRole("link", { name: "Sign in", exact: true })).toHaveCount(0);
});

test("the sign-in line unmounts while a sign-in initializes auth again", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/index/HomeWhileAuthUnavailable");
  const link = component.getByRole("link", { name: "Sign in", exact: true });
  await link.click();
  await holdResponses(page, "auth-config");
  const dialog = page.getByRole("dialog", { name: "Sign in", exact: true });
  await dialog.getByRole("button", { name: "Continue with Google" }).click();
  await expect(dialog.getByRole("button", { name: "Signing in…" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in", exact: true, includeHidden: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Already listening with Cup?")).toHaveCount(0);
});

test("renders landing when served from the iOS app's capacitor:// origin", async ({ mount }) => {
  const component = await mount("routes/index/LandingPageInIosApp");
  await expect(component.getByRole("heading", { name: "Just listen." })).toBeVisible();
});

test("the focused URL input shows only its wavy rule, without a focus ring", async ({ mount }) => {
  const component = await mount("routes/index/LandingPage");
  const input = component.getByRole("textbox", { name: "URL" });
  await input.focus();
  await expect(input).toBeFocused();
  await expect(input).toHaveCSS("outline-style", "none");
  await expect(component).toHaveScreenshot("landing-url-input-focused.png");
});

test("renders sign-in dialog", async ({ mount, page }) => {
  await mount("routes/index/SignIn");
  await expect(
    page.getByRole("heading", { name: "Just listen.", includeHidden: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "URL", includeHidden: true })).toHaveValue(
    "https://example.com/article",
  );
  await expect(page).toHaveScreenshot("sign-in-dialog.png");
});

test("offers only the sign-in methods the auth configuration advertises", async ({
  mount,
  page,
}) => {
  await mount("routes/index/SignInWithTestAccount");
  const dialog = page.getByRole("dialog", { name: "Sign in", exact: true });
  await expect(dialog.getByRole("button", { name: "Sign in with test account" })).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
});

test("anonymous submission asks for sign-in and cancellation preserves the URL", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/index/LandingPage");
  const input = component.getByRole("textbox", { name: "URL" });
  await input.fill("https://example.com/article");
  await component.getByRole("button", { name: "Listen" }).click();
  await expect(page.getByRole("dialog", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeFocused();
  await expect(page).toHaveScreenshot("signup-dialog.png");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(component.getByRole("button", { name: "Listen" })).toBeFocused();
  await expect(input).toHaveValue("https://example.com/article");
  await expect(page.getByRole("dialog", { name: "Sign in", exact: true })).not.toBeVisible();
  await page.reload();
  await mount("routes/index/LandingPage");
  await expect(input).toHaveValue("https://example.com/article");
  await expect(component.getByRole("button", { name: "Listen" })).toBeEnabled();
  await component.getByRole("button", { name: "Listen" }).click();
  await expect(page.getByRole("dialog", { name: "Sign in", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Sign in", exact: true })).not.toBeVisible();
  await expect(input).toHaveValue("https://example.com/article");
});

test("invalid account URL shows a field error and becomes submittable after correction", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/index/LandingPage");
  const input = component.getByRole("textbox", { name: "URL" });
  await input.fill("ftp://example.com/article");
  await component.getByRole("button", { name: "Listen" }).click();
  await expect(
    component.getByText("URL must use HTTP or HTTPS and cannot contain credentials", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("dialog", { name: "Sign in", exact: true })).not.toBeVisible();
  await input.fill("https://example.com/article");
  await expect(input).not.toHaveAttribute("aria-invalid", "true");
  await component.getByRole("button", { name: "Listen" }).click();
  await expect(page.getByRole("dialog", { name: "Sign in", exact: true })).toBeVisible();
});

test("the sign-in link opens the dialog with the returning listener's copy", async ({
  mount,
  page,
}) => {
  await mount("routes/index/SignInFromLink");
  const dialog = page.getByRole("dialog", { name: "Sign in", exact: true });
  await expect(dialog).toHaveAccessibleDescription("Sign in to get back to your tracks.");
  await expect(dialog.getByText("New accounts get 30 free minutes.")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Continue with Google" })).toBeFocused();
  await expect(page).toHaveScreenshot("sign-in-dialog-from-link.png");
});

test("a submission's dialog keeps the new account copy", async ({ mount, page }) => {
  await mount("routes/index/SignIn");
  await expect(
    page.getByRole("dialog", { name: "Sign in", exact: true }),
  ).toHaveAccessibleDescription("Sign in to listen. New accounts get 30 free minutes.");
});

test("Cancel and Escape on the link's dialog return to the link and keep the typed URL", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/index/LandingPage");
  const input = component.getByRole("textbox", { name: "URL" });
  await input.fill("https://example.com/typed");
  const link = component.getByRole("link", { name: "Sign in", exact: true });
  const dialog = page.getByRole("dialog", { name: "Sign in", exact: true });

  await link.click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(link).toBeFocused();
  await expect(input).toHaveValue("https://example.com/typed");

  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(link).toBeFocused();
  await expect(input).toHaveValue("https://example.com/typed");
});

test("reopening the dialog from the link drops a previous sign-in error", async ({
  mount,
  page,
}) => {
  const component = await mount("routes/index/HomeWhileAuthUnavailable");
  const link = component.getByRole("link", { name: "Sign in", exact: true });
  const dialog = page.getByRole("dialog", { name: "Sign in", exact: true });
  await link.click();
  await dialog.getByRole("button", { name: "Continue with Google" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await link.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});

test("the link's dialog offers only the sign-in methods the auth configuration advertises", async ({
  mount,
  page,
}) => {
  await mount("routes/index/SignInFromLinkWithTestAccount");
  const dialog = page.getByRole("dialog", { name: "Sign in", exact: true });
  await expect(dialog.getByRole("button", { name: "Sign in with test account" })).toBeFocused();
  await expect(dialog.getByRole("button")).toHaveText(["Cancel", "Sign in with test account"]);
});
