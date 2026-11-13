import { expect, test } from "#src/test-utils/component-test.ts";
import { recordConversionStarts } from "#src/test-utils/conversion-starts.ts";
import { holdResponses, releaseResponses } from "#src/test-utils/held-responses.ts";

test("submits a cold-start share and repeat shares through the form", async ({ page, mount }) => {
  const starts = recordConversionStarts(page);
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
            if (event instanceof CustomEvent) {
              listener({ text: String(event.detail) });
            }
          });
          return "share-listener";
        },
      },
    });
  });
  await mount("routes/trials.$grantId/OpenGrantForShares");
  await page.evaluate(async () => {
    const modulePath = "/src/platform/share-plugin.android.ts";
    const { initializeAndroidShare } = await import(modulePath);
    await initializeAndroidShare(() => {});
  });
  const component = page.locator("#root");

  const input = component.getByRole("textbox", { name: "URL", exact: true });
  await expect(input).toHaveValue("https://example.com/first?from=share");
  // A share that arrives while this start is pending waits for it to settle.
  await expect.poll(() => starts).toEqual(["https://example.com/first?from=share"]);
  await expect(component.getByRole("button", { name: "Listen" })).toBeEnabled();

  await input.fill("https://example.com/manual-edit");
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("test-share", { detail: "https://example.com/second" }));
  });
  await expect(input).toHaveValue("https://example.com/second");

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("test-share", { detail: "plain text without a URL" }));
  });
  await expect(input).toHaveValue("https://example.com/second");
  await expect(component.getByRole("button", { name: "Listen" })).toBeEnabled();
  await expect
    .poll(() => starts)
    .toEqual(["https://example.com/first?from=share", "https://example.com/second"]);
});

test("a share during a pending start waits and is submitted once that start settles", async ({
  page,
  mount,
}) => {
  const starts = recordConversionStarts(page);
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
          window.addEventListener("test-share", (event) => {
            if (event instanceof CustomEvent) {
              listener({ text: String(event.detail) });
            }
          });
          return "share-listener";
        },
      },
    });
  });
  await mount("routes/trials.$grantId/OpenGrantForShares");
  await holdResponses(page, "share-start");
  await page.evaluate(async () => {
    const modulePath = "/src/platform/share-plugin.android.ts";
    const { initializeAndroidShare } = await import(modulePath);
    await initializeAndroidShare(() => {});
  });
  const component = page.locator("#root");
  const input = component.getByRole("textbox", { name: "URL", exact: true });

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("test-share", { detail: "https://example.com/first" }));
  });
  await expect.poll(() => starts).toEqual(["https://example.com/first"]);
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("test-share", { detail: "https://example.com/second" }));
  });
  await expect(input).toHaveValue("https://example.com/first");

  await releaseResponses(page, "share-start");
  await expect(input).toHaveValue("https://example.com/second");
  await expect
    .poll(() => starts)
    .toEqual(["https://example.com/first", "https://example.com/second"]);
});

test("ignores shared Cup links, so a trial link never fills the form", async ({ page, mount }) => {
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
          window.addEventListener("test-share", (event) => {
            if (event instanceof CustomEvent) {
              listener({ text: String(event.detail) });
            }
          });
          return "share-listener";
        },
      },
    });
  });
  await mount("routes/trials.$grantId/OpenGrantForShares");
  const shares = await page.evaluate(async () => {
    let count = 0;
    const modulePath = "/src/platform/share-plugin.android.ts";
    const { initializeAndroidShare } = await import(modulePath);
    await initializeAndroidShare(() => {
      count++;
    });
    for (const text of [
      "Try Cup: https://cup.audio/app/trials/example#credential=v1.test",
      "https://www.cup.audio/app/trials/example",
      "https://cup-audio.com/trials/example",
    ]) {
      window.dispatchEvent(new CustomEvent("test-share", { detail: text }));
    }
    return count;
  });
  expect(shares).toBe(0);
  await expect(page.getByRole("textbox", { name: "URL", exact: true })).toHaveValue("");
});
