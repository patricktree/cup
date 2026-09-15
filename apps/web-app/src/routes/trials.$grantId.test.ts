import { expect, test } from "@playwright/test";

test("renders an open Trial", async ({ mount }) => {
  const component = await mount("routes/trials.$grantId/OpenGrant");

  await expect(component.getByRole("heading", { name: "Just listen." })).toBeVisible();
  await expect(component.getByRole("textbox", { name: "URL", exact: true })).toBeVisible();
  await expect(component.getByRole("button", { name: "Load & listen" })).toBeDisabled();
  await expect(component).toHaveScreenshot("open-trial.png");
});

test("rejects a malformed Trial credential", async ({ mount }) => {
  const component = await mount("routes/trials.$grantId/MalformedCredential");

  await expect(
    component.getByRole("heading", { name: "This Trial Link is invalid." }),
  ).toBeVisible();
  await expect(component).toHaveScreenshot("malformed-credential.png");
});

test("renders revoked-trial-link", async ({ mount }) => {
  const component = await mount("routes/trials.$grantId/RevokedCredential");
  await expect(
    component.getByRole("heading", { name: "This trial link was revoked." }),
  ).toBeVisible();
  await expect(component).toHaveScreenshot("revoked-trial-link.png");
});

test("renders credential-exchange-error", async ({ mount }) => {
  const component = await mount("routes/trials.$grantId/CredentialExchangeError");
  await expect(
    component.getByRole("heading", { name: "The trial link could not be opened." }),
  ).toBeVisible();
  await expect(component).toHaveScreenshot("credential-exchange-error.png");
});

test("renders grant-load-error", async ({ mount }) => {
  const component = await mount("routes/trials.$grantId/GrantLoadError");
  await expect(
    component.getByRole("heading", { name: "The trial link could not be opened." }),
  ).toBeVisible();
  await expect(component).toHaveScreenshot("grant-load-error.png");
});

test("renders an invalid source URL", async ({ mount }) => {
  const component = await mount("routes/trials.$grantId/OpenGrant");
  await component.getByRole("textbox", { name: /^URL/ }).fill("not a URL");
  await component.getByRole("textbox", { name: /^URL/ }).blur();
  await expect(component.getByRole("alert")).toHaveCount(0);
  await component.getByRole("button", { name: "Load & listen" }).click();
  await expect(component.getByRole("textbox", { name: /^URL/ })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(component.getByRole("button", { name: "Load & listen" })).toBeDisabled();
  await expect(component).toHaveScreenshot("invalid-article-url.png");
  await component.getByRole("textbox", { name: "URL", exact: true }).fill("https://example.com");
  await expect(component.getByRole("alert")).toHaveCount(0);
  await expect(component.getByRole("button", { name: "Load & listen" })).toBeEnabled();
});

test("renders a pending conversion start", async ({ mount }) => {
  const component = await mount("routes/trials.$grantId/StartPending");
  await component
    .getByRole("textbox", { name: /^URL/ })
    .fill("https://source.example.test/fixture");
  await component.getByRole("button", { name: "Load & listen" }).click();
  await expect(component.getByRole("button", { name: "Starting conversion..." })).toBeDisabled();
  await expect(component.getByRole("textbox", { name: /^URL/ })).toHaveValue(
    "https://source.example.test/fixture",
  );
  await expect(component).toHaveScreenshot("start-pending.png");
});
