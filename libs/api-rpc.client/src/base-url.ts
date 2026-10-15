/** Removes one trailing slash so Hono clients join API paths onto the base URL cleanly. */
export function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}
