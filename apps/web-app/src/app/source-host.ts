/** The host a source URL is shown by, such as "theverge.com", without a leading "www.". */
export function toSourceHost(sourceUrl: string): string {
  return new URL(sourceUrl).hostname.replace(/^www\./, "");
}
