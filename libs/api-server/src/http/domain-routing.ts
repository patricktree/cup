export const APPLICATION_ORIGIN = "https://cup.audio";

const REDIRECTED_HOSTNAMES = new Set([
  "www.cup.audio",
  "cup-audio.com",
  "www.cup-audio.com",
  "create-audiobook-from-url.patricktree.me",
]);

/**
 * Sends requests for former and alternate hostnames to the canonical domain, so historical links
 * keep working.
 */
export function routeApplicationDomain(request: Request): Response | undefined {
  const url = new URL(request.url);
  if (!REDIRECTED_HOSTNAMES.has(url.hostname)) {
    return undefined;
  }

  // Omit a fragment so browsers carry the original trial credential to the canonical domain.
  return Response.redirect(`${APPLICATION_ORIGIN}${url.pathname}${url.search}`, 308);
}
