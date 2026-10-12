import { handleAppLink } from "#src/platform/app-links.js";
import { receiveSharedUrl } from "#src/platform/share-intake.js";

export function handleShareLink(
  value: string,
  navigate: (href: string) => void,
  onShare: () => void,
): void {
  const envelope = URL.parse(value);
  if (
    envelope === null ||
    envelope.protocol !== "audio.cup.app:" ||
    envelope.hostname !== "share" ||
    envelope.username ||
    envelope.password ||
    envelope.port ||
    (envelope.pathname !== "" && envelope.pathname !== "/")
  )
    return;

  const url = URL.parse(envelope.searchParams.get("url") ?? "");
  if (url === null || !["http:", "https:"].includes(url.protocol) || url.username || url.password)
    return;

  if (!handleAppLink(url.href, navigate)) receiveSharedUrl(url.href, onShare);
}
