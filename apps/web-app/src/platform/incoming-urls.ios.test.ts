import { expect, test } from "@playwright/test";

test("delivers share URLs to the form and opens shared trial links in the app", async ({
  page,
  mount,
}) => {
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
  await mount("routes/trials.$grantId/OpenGrant");
  await page.evaluate(async () => {
    const modulePath = "/src/platform/incoming-urls.ios.ts";
    const { initializeIosIncomingUrls } = await import(modulePath);
    await initializeIosIncomingUrls(
      (href: string) => {
        document.title = href;
      },
      () => {},
    );
  });
  const input = page.getByRole("textbox", { name: "URL", exact: true });
  await expect(input).toHaveValue("https://example.com/first?a=1&b=2#section");
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
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("test-share", {
        detail:
          "audio.cup.app://share?url=" +
          encodeURIComponent("https://cup.audio/app/trials/example?from=share#credential=v1.test"),
      }),
    );
  });
  await expect(page).toHaveTitle("/app/trials/example?from=share#credential=v1.test");
});

test("ignores URLs other than share handoffs", async ({ page, mount }) => {
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
          url: "https://cup.audio/app/trials/test?from=keep#credential=v1.test",
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
  const result = await page.evaluate(async () => {
    const paths: string[] = [];
    let shares = 0;
    const modulePath = "/src/platform/incoming-urls.ios.ts";
    const { initializeIosIncomingUrls } = await import(modulePath);
    await initializeIosIncomingUrls(
      (href: string) => paths.push(href),
      () => {
        shares++;
      },
    );
    for (const url of [
      "https://cup.audio/app/audiobooks/next",
      "https://example.com/article",
      "audio.cup.app://other?url=" + encodeURIComponent("https://example.com/"),
      "not a URL",
    ]) {
      window.dispatchEvent(new CustomEvent("test-url-open", { detail: url }));
    }
    return { paths, shares };
  });
  expect(result).toEqual({ paths: [], shares: 0 });
});
