import { WEB_APP_CSP_NONCE_PLACEHOLDER } from "@cup/listener-api.routes/web-app-csp";

/** Replaces Vite's build-time CSP nonce placeholder with the nonce for this response. */
export async function applyWebAppCspNonce(response: Response, nonce: string): Promise<Response> {
  const html = (await response.text()).replaceAll(WEB_APP_CSP_NONCE_PLACEHOLDER, nonce);
  const headers = new Headers(response.headers);

  headers.set("Cache-Control", "private, no-store");
  headers.delete("Content-Encoding");
  headers.delete("Content-Length");
  headers.delete("ETag");

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
