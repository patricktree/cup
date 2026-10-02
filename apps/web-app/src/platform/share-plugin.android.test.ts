import { expect, test } from "@playwright/test";

test("fills the form from a cold-start share and accepts repeat shares without submitting", async ({
  page,
  mount,
}) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      androidBridge: {},
      Capacitor: {
        PluginHeaders: [{ name: "AndroidShare", methods: [{ name: "addListener" }] }],
        nativeCallback: (
          _plugin: string,
          _method: string,
          _options: unknown,
          listener: (payload: { text: string }) => void,
        ) => {
          listener({ text: "An article\nhttps://example.com/first?from=share" });
          window.addEventListener("test-share", (event) => {
            if (event instanceof CustomEvent) listener({ text: String(event.detail) });
          });
          return "share-listener";
        },
      },
    });
  });
  await mount("routes/trials.$grantId/OpenGrant");
  await page.evaluate(async () => {
    const modulePath = "/src/platform/share-plugin.android.ts";
    const { initializeAndroidShare } = await import(modulePath);
    await initializeAndroidShare(() => {});
  });
  const component = page.locator("#root");

  const input = component.getByRole("textbox", { name: "URL", exact: true });
  await expect(input).toHaveValue("https://example.com/first?from=share");
  await expect(component.getByRole("button", { name: "Load & listen" })).toBeEnabled();

  await input.fill("https://example.com/manual-edit");
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("test-share", { detail: "https://example.com/second" }));
  });
  await expect(input).toHaveValue("https://example.com/second");

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("test-share", { detail: "plain text without a URL" }));
  });
  await expect(input).toHaveValue("https://example.com/second");
  await expect(component.getByRole("button", { name: "Load & listen" })).toBeEnabled();
});
