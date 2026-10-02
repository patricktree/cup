import crypto from "node:crypto";
import http from "node:http";
import { Temporal } from "temporal-polyfill";

const SUBJECT = "880ce5b5-6542-40fd-8f2d-380f3066e98a";
const OTHER_SUBJECT = "70fcf2d9-63c5-48be-b897-d3670f24ed43";
const nowSeconds = () => Math.floor(Temporal.Now.instant().epochMilliseconds / 1000);

/** Local identity boundary: real PKCE, signed access tokens and JWKS, with no Google traffic. */
export async function startAuthProvider() {
  const pair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKey = {
    ...pair.publicKey.export({ format: "jwk" }),
    kid: "qa-key",
    alg: "ES256",
    use: "sig",
  };
  const codes = new Map<string, { challenge: string; authenticatedAt: number }>();
  let origin = "";
  let exchanges = 0;
  const tokenFor = (subject: string, authenticatedAt = nowSeconds()) => {
    const now = nowSeconds();
    const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: "qa-key" })).toString(
      "base64url",
    );
    const payload = Buffer.from(
      JSON.stringify({
        iss: `${origin}/auth/v1`,
        sub: subject,
        aud: "authenticated",
        role: "authenticated",
        email: "reader@example.test",
        iat: now,
        exp: now + 300,
        app_metadata: { provider: "google" },
        amr: [{ method: "oauth", timestamp: authenticatedAt }],
      }),
    ).toString("base64url");
    const message = `${header}.${payload}`;
    return `${message}.${crypto.sign("sha256", Buffer.from(message), { key: pair.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  };
  const authorize = (url: URL, response: http.ServerResponse) => {
    const redirect = new URL(url.searchParams.get("redirect_to") ?? "");
    if (
      url.searchParams.get("provider") !== "google" ||
      url.searchParams.get("code_challenge_method")?.toLowerCase() !== "s256" ||
      redirect.hostname !== "127.0.0.1"
    )
      throw new Error("Invalid QA OAuth request");
    const code = crypto.randomUUID();
    codes.set(code, {
      challenge: url.searchParams.get("code_challenge") ?? "",
      authenticatedAt: nowSeconds(),
    });
    redirect.searchParams.set("code", code);
    response.writeHead(302, { Location: redirect.href }).end();
  };
  const exchange = async (
    url: URL,
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
    if (
      url.searchParams.get("grant_type") !== "pkce" ||
      !body ||
      typeof body !== "object" ||
      !("auth_code" in body) ||
      typeof body.auth_code !== "string" ||
      !("code_verifier" in body) ||
      typeof body.code_verifier !== "string"
    )
      throw new Error("Invalid PKCE exchange");
    const code = codes.get(body.auth_code);
    if (
      !code ||
      crypto.createHash("sha256").update(body.code_verifier).digest("base64url") !== code.challenge
    )
      throw new Error("PKCE verification failed");
    codes.delete(body.auth_code);
    exchanges += 1;
    response.end(
      JSON.stringify({
        access_token: tokenFor(SUBJECT, code.authenticatedAt),
        token_type: "bearer",
        refresh_token: "qa-refresh",
        expires_in: 300,
        user: {
          id: SUBJECT,
          email: "reader@example.test",
          aud: "authenticated",
          app_metadata: { provider: "google" },
          user_metadata: {},
          identities: [{ provider: "google", identity_data: { sub: "qa-google" } }],
        },
      }),
    );
  };
  const server = http.createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
    );
    response.setHeader("Content-Type", "application/json");
    const handle = async () => {
      const url = new URL(request.url ?? "/", origin);
      if (request.method === "OPTIONS") {
        response.writeHead(204).end();
        return;
      }
      if (url.pathname.endsWith("/.well-known/jwks.json")) {
        response.end(JSON.stringify({ keys: [publicKey] }));
        return;
      }
      if (url.pathname === "/auth/v1/authorize") {
        authorize(url, response);
        return;
      }
      if (url.pathname === "/auth/v1/token") {
        await exchange(url, request, response);
        return;
      }
      if (url.pathname === "/auth/v1/logout") {
        response.writeHead(204).end();
        return;
      }
      if (
        url.pathname.startsWith("/auth/v1/admin/users/") &&
        request.headers.authorization === "Bearer qa-admin"
      ) {
        const id = url.pathname.split("/").at(-1);
        if (id === SUBJECT || id === OTHER_SUBJECT) {
          response.end(JSON.stringify({ id }));
          return;
        }
      }
      response.writeHead(404).end(JSON.stringify({ message: "Unknown QA identity route" }));
    };
    void handle().catch((error: unknown) => {
      response.writeHead(400).end(JSON.stringify({ message: String(error) }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No identity port");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    otherToken: () => tokenFor(OTHER_SUBJECT),
    exchanges: () => exchanges,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
