import { expect, test } from "vitest";

import { WEB_APP_CSP_NONCE_PLACEHOLDER } from "@cup/listener-api.routes/web-app-csp";

import { applyWebAppCspNonce } from "#src/http/web-app-csp.ts";

test("replaces Vite's CSP nonce placeholder without retaining stale representation metadata", async () => {
  const response = new Response(
    `<meta nonce="${WEB_APP_CSP_NONCE_PLACEHOLDER}"><script nonce="${WEB_APP_CSP_NONCE_PLACEHOLDER}"></script>`,
    {
      headers: {
        "Cache-Control": "public, max-age=3600",
        "Content-Encoding": "gzip",
        "Content-Length": "100",
        "Content-Type": "text/html; charset=utf-8",
        ETag: '"original"',
      },
    },
  );

  const transformedResponse = await applyWebAppCspNonce(response, "request-nonce");

  await expect(transformedResponse.text()).resolves.toBe(
    '<meta nonce="request-nonce"><script nonce="request-nonce"></script>',
  );
  expect(transformedResponse.headers.get("Cache-Control")).toBe("private, no-store");
  expect(transformedResponse.headers.has("Content-Encoding")).toBe(false);
  expect(transformedResponse.headers.has("Content-Length")).toBe(false);
  expect(transformedResponse.headers.has("ETag")).toBe(false);
  expect(transformedResponse.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
});
