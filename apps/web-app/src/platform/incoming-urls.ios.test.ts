import { expect, test } from "@playwright/test";

import { recordConversionStarts } from "#src/test-utils/conversion-starts.ts";

test("submits share URLs through the form", async ({ page, mount }) => {
  const starts = recordConversionStarts(page);
  await page.addInitScript(() => {
    Object.assign(window, {
      webkit: { messageHandlers: { bridge: {} } },
      Capacitor: {
        PluginHeaders: [
          {
            name: "App",
            methods: [{ name: "addListener" }, { name: "getLaunchUrl", rtype: "promise" }],
          },
        ],
        nativePromise: async () => ({
          url:
            "audio.cup.app://share?url=" +
            encodeURIComponent("https://example.com/first?a=1&b=2#section"),
        }),
        nativeCallback: (
          _plugin: string,
          _method: string,
          _options: unknown,
          listener: (payload: { url: string }) => void,
        ) => {
          window.addEventListener("test-share", (event) => {
            if (event instanceof CustomEvent) {
              listener({ url: String(event.detail) });
            }
          });
          return "share-listener";
        },
      },
    });
  });
  await mount("routes/trials.$grantId/OpenGrantForShares");
  await page.evaluate(async () => {
    const modulePath = "/src/platform/incoming-urls.ios.ts";
    const { initializeIosIncomingUrls } = await import(modulePath);
    await initializeIosIncomingUrls(() => {});
  });
  const input = page.getByRole("textbox", { name: "URL", exact: true });
  await expect(input).toHaveValue("https://example.com/first?a=1&b=2#section");
  // A share that arrives while this start is pending waits for it to settle.
  await expect.poll(() => starts).toEqual(["https://example.com/first?a=1&b=2#section"]);
  await expect(page.getByRole("button", { name: "Listen" })).toBeEnabled();
  for (const value of [
    "https://example.com/second",
    "javascript:alert(1)",
    "https://user:password@example.com/",
  ]) {
    await page.evaluate((url) => {
      window.dispatchEvent(
        new CustomEvent("test-share", {
          detail: "audio.cup.app://share?url=" + encodeURIComponent(url),
        }),
      );
    }, value);
  }
  await expect(input).toHaveValue("https://example.com/second");
  await expect(page.getByRole("button", { name: "Listen" })).toBeEnabled();
  await expect
    .poll(() => starts)
    .toEqual(["https://example.com/first?a=1&b=2#section", "https://example.com/second"]);
});

test("ignores shared Cup links and URLs other than share handoffs", async ({ page, mount }) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      webkit: { messageHandlers: { bridge: {} } },
      Capacitor: {
        PluginHeaders: [
          {
            name: "App",
            methods: [{ name: "addListener" }, { name: "getLaunchUrl", rtype: "promise" }],
          },
        ],
        nativePromise: async () => ({
          url:
            "audio.cup.app://share?url=" +
            encodeURIComponent("https://cup.audio/app/trials/test?from=keep#credential=v1.test"),
        }),
        nativeCallback: (
          _plugin: string,
          _method: string,
          _options: unknown,
          listener: (payload: { url: string }) => void,
        ) => {
          window.addEventListener("test-url-open", (event) => {
            if (event instanceof CustomEvent) {
              listener({ url: String(event.detail) });
            }
          });
          return "url-open-listener";
        },
      },
    });
  });
  await mount("routes/index/LandingPage");
  const shares = await page.evaluate(async () => {
    let count = 0;
    const modulePath = "/src/platform/incoming-urls.ios.ts";
    const { initializeIosIncomingUrls } = await import(modulePath);
    await initializeIosIncomingUrls(() => {
      count++;
    });
    for (const url of [
      "https://cup.audio/app/audiobooks/next",
      "audio.cup.app://share?url=" +
        encodeURIComponent("https://cup.audio/app/trials/example#credential=v1.test"),
      "audio.cup.app://share?url=" + encodeURIComponent("https://cup-audio.com/trials/example"),
      "https://example.com/article",
      "audio.cup.app://other?url=" + encodeURIComponent("https://example.com/"),
      "not a URL",
    ]) {
      window.dispatchEvent(new CustomEvent("test-url-open", { detail: url }));
    }
    return count;
  });
  expect(shares).toBe(0);
});
