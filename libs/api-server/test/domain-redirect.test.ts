import { expect, test } from "vitest";

import { routeApplicationDomain } from "#src/domain-routing.ts";

const REDIRECTED_ORIGINS = [
  "https://www.cup.audio",
  "https://cup-audio.com",
  "https://www.cup-audio.com",
  "https://create-audiobook-from-url.patricktree.me",
];

test.each(REDIRECTED_ORIGINS)(
  "redirects trial links on %s without losing query parameters",
  (origin) => {
    for (const method of ["GET", "HEAD"]) {
      for (const pathname of ["/trials/existing", "/app/trials/existing", "/trials/existing/"]) {
        const response = routeApplicationDomain(
          new Request(`${origin}${pathname}?from=email&tag=a&tag=b`, { method }),
        );
        expect(response?.status).toBe(308);
        expect(response?.headers.get("Location")).toBe(
          `https://cup.audio${pathname}?from=email&tag=a&tag=b`,
        );
        expect(response?.headers.get("Location")).not.toContain("#");
      }
    }
  },
);

test.each(REDIRECTED_ORIGINS)("redirects every other path and method on %s", (origin) => {
  for (const pathname of [
    "/",
    "/app/",
    "/app/account",
    "/api/operator/grants",
    "/api/grants/existing",
    "/.well-known/assetlinks.json",
  ]) {
    const response = routeApplicationDomain(new Request(`${origin}${pathname}`));
    expect(response?.status).toBe(308);
    expect(response?.headers.get("Location")).toBe(`https://cup.audio${pathname}`);
  }

  const response = routeApplicationDomain(
    new Request(`${origin}/api/grants/existing/sessions`, { method: "POST" }),
  );
  expect(response?.status).toBe(308);
  expect(response?.headers.get("Location")).toBe("https://cup.audio/api/grants/existing/sessions");
});

test("leaves the canonical domain and local development to the application router", () => {
  for (const origin of ["https://cup.audio", "http://localhost:5173"]) {
    expect(routeApplicationDomain(new Request(`${origin}/trials/existing`))).toBeUndefined();
  }
});
