import { expect, test } from "@playwright/test";

test("opens cold-start and repeat App Links while rejecting other origins", async ({
  page,
  mount,
}) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      androidBridge: {},
      Capacitor: {
        PluginHeaders: [{ name: "AndroidAppLinks", methods: [{ name: "addListener" }] }],
        nativeCallback: (
          _plugin: string,
          _method: string,
          _options: unknown,
          listener: (payload: { url: string }) => void,
        ) => {
          listener({
            url: "https://cup-audio.com/app/trials/test?from=link#credential=v1.test",
          });
          window.addEventListener("test-app-link", (event) => {
            if (event instanceof CustomEvent) listener({ url: String(event.detail) });
          });
          return "app-link-listener";
        },
      },
    });
  });
  await mount("routes/index/LandingPage");
  const receivedPaths = await page.evaluate(async () => {
    const paths: string[] = [];
    const modulePath = "/src/platform/app-links.android.ts";
    const { initializeAndroidAppLinks } = await import(modulePath);
    await initializeAndroidAppLinks((href: string) => paths.push(href));
    for (const url of [
      "https://cup-audio.com/app/audiobooks/next",
      "https://create-audiobook-from-url.patricktree.me/app/trials/old",
      "https://example.com/trials/untrusted",
      "http://cup-audio.com/",
      "https://cup-audio.com.evil.test/",
      "not a URL",
      "https://cup-audio.com/app/audiobooks/test",
      "https://cup-audio.com/app/",
      "https://cup-audio.com/app",
      "https://cup-audio.com/",
      "https://cup-audio.com/trials/legacy",
      "https://cup-audio.com/application",
      "https://cup-audio.com/api/grants/test",
    ]) {
      window.dispatchEvent(new CustomEvent("test-app-link", { detail: url }));
    }
    return paths;
  });
  expect(receivedPaths).toEqual([
    "/app/trials/test?from=link#credential=v1.test",
    "/app/audiobooks/next",
    "/app/audiobooks/test",
    "/app/",
    "/app",
  ]);
});
