import http from "node:http";

export type SharedPage = {
  /** The page's URL on the host's loopback, at `pathAndQuery`. */
  url(pathAndQuery: string): string;
  close(): Promise<void>;
};

/** The heading every path of the page shows, which Safari renders once it has loaded the page. */
export const SHARED_PAGE_HEADING = "Shared article";

/**
 * Serves the web page that Safari opens and shares, on `127.0.0.1` at a port the operating system
 * assigns, so a share needs no internet. The simulator shares the Mac's loopback, and an IP address
 * leaves Safari no `::1` to try first.
 */
export async function startSharedPage(): Promise<SharedPage> {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      `<!doctype html><title>${SHARED_PAGE_HEADING}</title><h1>${SHARED_PAGE_HEADING}</h1>`,
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The shared page's server has no TCP address.");
  }
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    url: (pathAndQuery) => `${origin}${pathAndQuery}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
