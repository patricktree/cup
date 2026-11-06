import { receiveSharedUrl } from "#src/platform/share-intake.js";

export function handleShareLink(
  incomingUrl: string,
  navigate: (href: string) => void,
  onShare: () => void | Promise<void>,
): void {
  const envelope = URL.parse(incomingUrl);
  if (
    envelope === null ||
    envelope.protocol !== "audio.cup.app:" ||
    envelope.hostname !== "share" ||
    envelope.username ||
    envelope.password ||
    envelope.port ||
    (envelope.pathname !== "" && envelope.pathname !== "/")
  ) {
    return;
  }

  const url = URL.parse(envelope.searchParams.get("url") ?? "");
  if (url === null || !["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    return;
  }

  if (
    url.origin === "https://cup.audio" &&
    (url.pathname === "/app" || url.pathname.startsWith("/app/"))
  ) {
    // A shared trial link opens its route; keep the query and the trial credential fragment.
    navigate(url.pathname + url.search + url.hash);
    return;
  }
  receiveSharedUrl(url.href, onShare);
}
