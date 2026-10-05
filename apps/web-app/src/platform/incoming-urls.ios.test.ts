import { expect, test } from "@playwright/test";

test("delivers share URLs to the form and preserves trial credentials", async ({ page, mount }) => {
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
            "cup-audio://share?url=" +
            encodeURIComponent("https://example.com/first?a=1&b=2#section"),
        }),
        nativeCallback: (
          _plugin: string,
          _method: string,
          _options: unknown,
          listener: (payload: { url: string }) => void,
        ) => {
          window.addEventListener("test-share", (event) => {
            if (event instanceof CustomEvent) listener({ url: String(event.detail) });
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
          detail: "cup-audio://share?url=" + encodeURIComponent(url),
        }),
      );
    }, value);
  }
  await expect(input).toHaveValue("https://example.com/second");
  await expect(page.getByRole("button", { name: "Load & listen" })).toBeEnabled();
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("test-share", {
        detail:
          "cup-audio://share?url=" +
          encodeURIComponent(
            "https://cup-audio.com/app/trials/example?from=share#credential=v1.test",
          ),
      }),
    );
  });
  await expect(page).toHaveTitle("/app/trials/example?from=share#credential=v1.test");
});

test("opens cold-start and repeat Universal Links only for Cup app routes", async ({
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
          url: "https://cup-audio.com/app/trials/test?from=keep#credential=v1.test",
        }),
        nativeCallback: (
          _plugin: string,
          _method: string,
          _options: unknown,
          listener: (payload: { url: string }) => void,
        ) => {
          window.addEventListener("test-app-link", (event) => {
            if (event instanceof CustomEvent) listener({ url: String(event.detail) });
          });
          return "app-link-listener";
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
      "https://cup-audio.com/app/audiobooks/next",
      "https://cup-audio.com/app",
      "https://cup-audio.com/app/",
      "https://cup-audio.com/app/trials/next#credential=v1.a+b",
      "https://example.com/app/trials/test",
      "https://cup-audio.com.evil.test/app",
      "http://cup-audio.com/app",
      "https://user:password@cup-audio.com/app",
      "https://cup-audio.com:444/app",
      "https://cup-audio.com/application",
      "https://cup-audio.com/api/grants/test",
      "https://cup-audio.com/",
      "not a URL",
    ])
      window.dispatchEvent(new CustomEvent("test-app-link", { detail: url }));
    return { paths, shares };
  });
  expect(result).toEqual({
    paths: [
      "/app/trials/test?from=keep#credential=v1.test",
      "/app/audiobooks/next",
      "/app",
      "/app/",
      "/app/trials/next#credential=v1.a+b",
    ],
    shares: 0,
  });
});
