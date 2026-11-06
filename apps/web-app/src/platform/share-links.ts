import { receiveSharedUrl } from "#src/platform/share-intake.js";

export function handleShareLink(incomingUrl: string, onShare: () => void | Promise<void>): void {
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

  receiveSharedUrl(url.href, onShare);
}
