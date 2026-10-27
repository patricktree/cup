/**
 * The host a track came from, as shown under its card and in the detail view: the source URL's host
 * name without a leading "www.". A URL that does not parse shows as given, so a malformed stored
 * URL stays recognizable.
 */
export function toSourceHost(sourceUrl: string): string {
  if (!URL.canParse(sourceUrl)) {
    return sourceUrl;
  }

  return new URL(sourceUrl).hostname.replace(/^www\./, "");
}
