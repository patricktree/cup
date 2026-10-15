export function handleAppLink(value: string, navigate: (href: string) => void): boolean {
  const url = URL.parse(value);
  if (
    url === null ||
    url.origin !== "https://cup.audio" ||
    url.username ||
    url.password ||
    (url.pathname !== "/app" && !url.pathname.startsWith("/app/"))
  ) {
    return false;
  }

  // Keep query parameters and the trial credential fragment when changing origins.
  navigate(url.pathname + url.search + url.hash);
  return true;
}
