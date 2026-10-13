import { expect, test } from "vitest";

import {
  detectCoverImageContentType,
  type CoverImageBrowser,
  loadCoverImage,
  MAX_COVER_IMAGE_BYTES,
} from "#src/load-cover-image.ts";

const SOURCE_URL = "https://publisher.example/story";
const COVER_IMAGE_URL = "https://cdn.publisher.example/cover.jpg";
const JPEG_BYTES = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);
const PNG_BYTES = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00);

type FakeResponse = {
  body?: () => Promise<Uint8Array>;
  headers?: Record<string, string>;
  redirectedFromUrls?: string[];
  status?: number;
};

/** Records what the loader asks of the browser and answers the navigation with one response. */
function createBrowser(response: FakeResponse) {
  const observed = {
    cookies: [] as unknown[],
    extraHeaders: {} as Record<string, string>,
    javaScriptEnabled: undefined as boolean | undefined,
    navigation: undefined as { url: string; referer: string; waitUntil: string } | undefined,
    isPageClosed: false,
    wasBodyRead: false,
  };
  const browser = {
    newPage: async ({ javaScriptEnabled }) => {
      observed.javaScriptEnabled = javaScriptEnabled;

      return {
        route: async () => {},
        context: () => ({
          addCookies: async (cookies) => {
            observed.cookies = cookies;
          },
        }),
        setExtraHTTPHeaders: async (headers) => {
          observed.extraHeaders = headers;
        },
        goto: async (url, { referer, waitUntil }) => {
          observed.navigation = { url, referer, waitUntil };
          const requests = [...(response.redirectedFromUrls ?? []), url];

          return {
            status: () => response.status ?? 200,
            headers: () => response.headers ?? {},
            body: () => {
              observed.wasBodyRead = true;
              return response.body ? response.body() : Promise.resolve(JPEG_BYTES);
            },
            request: () => createRequest(requests, requests.length - 1),
          };
        },
        close: async () => {
          observed.isPageClosed = true;
        },
      };
    },
  } satisfies CoverImageBrowser;

  return { browser, observed };
}

type FakeRequest = { url(): string; redirectedFrom(): FakeRequest | null };

function createRequest(urls: readonly string[], index: number): FakeRequest {
  return {
    url: () => urls[index] ?? "",
    redirectedFrom: () => (index === 0 ? null : createRequest(urls, index - 1)),
  };
}

test("requests the declared image as a navigation from the source page", async () => {
  const cookies = [{ name: "session", value: "1", domain: ".publisher.example", path: "/" }];
  const { browser, observed } = createBrowser({});

  await expect(
    loadCoverImage({
      browser,
      cookies,
      declaration: { url: COVER_IMAGE_URL },
      sourceUrl: SOURCE_URL,
    }),
  ).resolves.toEqual({ result: "loaded", bytes: JPEG_BYTES, contentType: "image/jpeg" });

  expect(observed.javaScriptEnabled).toBe(false);
  expect(observed.cookies).toEqual(cookies);
  expect(observed.navigation).toEqual({
    url: COVER_IMAGE_URL,
    referer: SOURCE_URL,
    waitUntil: "commit",
  });
  expect(observed.extraHeaders["Accept"]).toContain("image/avif");
  expect(observed.isPageClosed).toBe(true);
});

test("identifies the image type from its bytes rather than the response header", async () => {
  const { browser } = createBrowser({
    body: async () => PNG_BYTES,
    headers: { "content-type": "image/jpeg" },
  });

  await expect(
    loadCoverImage({ browser, declaration: { url: COVER_IMAGE_URL }, sourceUrl: SOURCE_URL }),
  ).resolves.toMatchObject({ result: "loaded", contentType: "image/png" });
});

test("refuses a non-public image URL without opening a page", async () => {
  const browser = {
    newPage: () => Promise.reject(new Error("No page should be opened")),
  } satisfies CoverImageBrowser;

  await expect(
    loadCoverImage({
      browser,
      declaration: { url: "http://169.254.169.254/latest/meta-data" },
      sourceUrl: SOURCE_URL,
    }),
  ).resolves.toEqual({ result: "refused", reason: "non-public-destination" });
});

test("refuses an image reached through a non-public redirect hop", async () => {
  const { browser, observed } = createBrowser({
    redirectedFromUrls: [COVER_IMAGE_URL, "http://10.0.0.5/internal.jpg"],
  });

  await expect(
    loadCoverImage({ browser, declaration: { url: COVER_IMAGE_URL }, sourceUrl: SOURCE_URL }),
  ).resolves.toEqual({ result: "refused", reason: "non-public-destination" });
  expect(observed.wasBodyRead).toBe(false);
  expect(observed.isPageClosed).toBe(true);
});

test("refuses an HTTP error response", async () => {
  const { browser } = createBrowser({ status: 403 });

  await expect(
    loadCoverImage({ browser, declaration: { url: COVER_IMAGE_URL }, sourceUrl: SOURCE_URL }),
  ).resolves.toEqual({ result: "refused", reason: "http-error" });
});

test("refuses an image whose declared length exceeds the limit without reading it", async () => {
  const { browser, observed } = createBrowser({
    headers: { "content-length": String(MAX_COVER_IMAGE_BYTES + 1) },
  });

  await expect(
    loadCoverImage({ browser, declaration: { url: COVER_IMAGE_URL }, sourceUrl: SOURCE_URL }),
  ).resolves.toEqual({ result: "refused", reason: "too-large" });
  expect(observed.wasBodyRead).toBe(false);
});

test("refuses an image that exceeds the limit despite an understated length", async () => {
  const oversizedBytes = new Uint8Array(MAX_COVER_IMAGE_BYTES + 1);
  oversizedBytes.set(JPEG_BYTES);
  const { browser } = createBrowser({
    body: async () => oversizedBytes,
    headers: { "content-length": "1024" },
  });

  await expect(
    loadCoverImage({ browser, declaration: { url: COVER_IMAGE_URL }, sourceUrl: SOURCE_URL }),
  ).resolves.toEqual({ result: "refused", reason: "too-large" });
});

test("refuses a response that is not an accepted image type", async () => {
  const { browser } = createBrowser({
    body: async () => new TextEncoder().encode("<!doctype html><title>Sign in</title>"),
    headers: { "content-type": "image/jpeg" },
  });

  await expect(
    loadCoverImage({ browser, declaration: { url: COVER_IMAGE_URL }, sourceUrl: SOURCE_URL }),
  ).resolves.toEqual({ result: "refused", reason: "unsupported-type" });
});

test("fails rather than refuses when the body cannot be read, and closes the page", async () => {
  const { browser, observed } = createBrowser({
    body: () => Promise.reject(new Error("Connection reset")),
  });

  await expect(
    loadCoverImage({ browser, declaration: { url: COVER_IMAGE_URL }, sourceUrl: SOURCE_URL }),
  ).rejects.toThrow("Connection reset");
  expect(observed.isPageClosed).toBe(true);
});

test.each([
  ["image/jpeg", JPEG_BYTES],
  ["image/png", PNG_BYTES],
  ["image/webp", asciiBytes("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ")],
  [
    "image/avif",
    asciiBytes("\u0000\u0000\u0000\u001Cftypavif\u0000\u0000\u0000\u0000avifmif1miaf"),
  ],
  ["image/avif", asciiBytes("\u0000\u0000\u0000\u0018ftypmif1\u0000\u0000\u0000\u0000mif1avif")],
  ["image/gif", asciiBytes("GIF89a")],
  ["image/gif", asciiBytes("GIF87a")],
] as const)("detects %s", (contentType, bytes) => {
  expect(detectCoverImageContentType(bytes)).toBe(contentType);
});

test.each([
  ["a file that only resembles a GIF", asciiBytes("GIF90a")],
  ["an SVG", asciiBytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
  ["an HEIC image", asciiBytes("\u0000\u0000\u0000\u0018ftypheic\u0000\u0000\u0000\u0000mif1heic")],
  [
    "an animated AVIF sequence",
    asciiBytes("\u0000\u0000\u0000\u0014ftypavis\u0000\u0000\u0000\u0000"),
  ],
  ["an empty file", new Uint8Array()],
])("does not accept %s", (_description, bytes) => {
  expect(detectCoverImageContentType(bytes)).toBeUndefined();
});

function asciiBytes(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.codePointAt(0) ?? 0);
}
