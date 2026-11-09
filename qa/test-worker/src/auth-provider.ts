import crypto from "node:crypto";
import http from "node:http";
import { Temporal } from "temporal-polyfill";

const SUBJECT = "880ce5b5-6542-40fd-8f2d-380f3066e98a";
/**
 * Supabase fills `name` from Google's ID token; the web app shows its initials ("rd") in the
 * avatar.
 */
const READER_NAME = "Reader Doe";
const OTHER_SUBJECT = "70fcf2d9-63c5-48be-b897-d3670f24ed43";
/** The issuer of the Google ID tokens that the Android debug build's sign-in fake asks for. */
const GOOGLE_ISSUER = "https://accounts.google.com";
const GOOGLE_SUBJECT = "qa-google";
const nowSeconds = () => Math.floor(Temporal.Now.instant().epochMilliseconds / 1000);

type StartAuthProviderOptions = {
  /**
   * The host in the provider's origin, which is also in its token issuer. `localhost` makes it
   * listen on both the IPv4 and the IPv6 loopback, wherever a client resolves `localhost` to.
   */
  hostname?: "127.0.0.1" | "localhost";
};

/**
 * Local identity boundary: real PKCE, a Google ID token exchange with Supabase's nonce check,
 * signed access tokens and JWKS, with no Google traffic.
 */
export async function startAuthProvider(options: StartAuthProviderOptions = {}) {
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
  const sign = (claims: Record<string, unknown>) => {
    const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: "qa-key" })).toString(
      "base64url",
    );
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const message = `${header}.${payload}`;
    return `${message}.${crypto.sign("sha256", Buffer.from(message), { key: pair.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  };
  /** Returns the claims of a token this provider signed, or undefined for any other token. */
  const verify = (token: string): Record<string, unknown> | undefined => {
    const [header, payload, signature] = token.split(".");
    if (
      header === undefined ||
      payload === undefined ||
      signature === undefined ||
      !crypto.verify(
        "sha256",
        Buffer.from(`${header}.${payload}`),
        { key: pair.publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature, "base64url"),
      )
    ) {
      return undefined;
    }
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString());
    return claims && typeof claims === "object" ? { ...claims } : undefined;
  };
  const tokenFor = (
    subject: string,
    authenticatedAt = nowSeconds(),
    method: "oauth" | "id_token" = "oauth",
  ) => {
    const now = nowSeconds();
    return sign({
      iss: `${origin}/auth/v1`,
      sub: subject,
      aud: "authenticated",
      role: "authenticated",
      email: "reader@example.test",
      iat: now,
      exp: now + 300,
      app_metadata: { provider: "google" },
      amr: [{ method, timestamp: authenticatedAt }],
    });
  };
  /** The Google-provider session that both the PKCE and the ID token exchange return. */
  const sessionFor = (authenticatedAt: number, method: "oauth" | "id_token") =>
    JSON.stringify({
      access_token: tokenFor(SUBJECT, authenticatedAt, method),
      token_type: "bearer",
      refresh_token: "qa-refresh",
      expires_in: 300,
      user: {
        id: SUBJECT,
        email: "reader@example.test",
        aud: "authenticated",
        app_metadata: { provider: "google" },
        user_metadata: { name: READER_NAME, full_name: READER_NAME },
        identities: [{ provider: "google", identity_data: { sub: GOOGLE_SUBJECT } }],
      },
    });
  const authorize = (url: URL, response: http.ServerResponse) => {
    const redirect = new URL(url.searchParams.get("redirect_to") ?? "");
    if (
      url.searchParams.get("provider") !== "google" ||
      url.searchParams.get("code_challenge_method")?.toLowerCase() !== "s256" ||
      redirect.hostname !== "127.0.0.1"
    ) {
      throw new Error("Invalid QA OAuth request");
    }
    const code = crypto.randomUUID();
    codes.set(code, {
      challenge: url.searchParams.get("code_challenge") ?? "",
      authenticatedAt: nowSeconds(),
    });
    redirect.searchParams.set("code", code);
    response.writeHead(302, { Location: redirect.href }).end();
  };
  /**
   * Stands in for Google's sign-in sheet: returns a Google ID token for the account that carries
   * the hashed nonce the app passed to the sign-in plugin.
   */
  const issueGoogleIdToken = async (
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) => {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || !("nonce" in body) || typeof body.nonce !== "string") {
      throw new Error("Invalid QA Google ID token request");
    }
    const now = nowSeconds();
    response.end(
      JSON.stringify({
        idToken: sign({
          iss: GOOGLE_ISSUER,
          aud: "qa-google-client",
          sub: GOOGLE_SUBJECT,
          email: "reader@example.test",
          name: READER_NAME,
          nonce: body.nonce,
          iat: now,
          exp: now + 300,
        }),
        userId: GOOGLE_SUBJECT,
        email: "reader@example.test",
        displayName: READER_NAME,
      }),
    );
  };
  const exchange = async (
    url: URL,
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) => {
    const body = await readJson(request);
    if (url.searchParams.get("grant_type") === "id_token") {
      exchangeIdToken(body, response);
      return;
    }
    if (
      url.searchParams.get("grant_type") !== "pkce" ||
      !body ||
      typeof body !== "object" ||
      !("auth_code" in body) ||
      typeof body.auth_code !== "string" ||
      !("code_verifier" in body) ||
      typeof body.code_verifier !== "string"
    ) {
      throw new Error("Invalid PKCE exchange");
    }
    const code = codes.get(body.auth_code);
    if (
      !code ||
      crypto.createHash("sha256").update(body.code_verifier).digest("base64url") !== code.challenge
    ) {
      throw new Error("PKCE verification failed");
    }
    codes.delete(body.auth_code);
    exchanges += 1;
    response.end(sessionFor(code.authenticatedAt, "oauth"));
  };
  /** As Supabase does, accepts the ID token only when it carries the SHA-256 hash of the raw nonce. */
  const exchangeIdToken = (body: unknown, response: http.ServerResponse) => {
    if (
      !body ||
      typeof body !== "object" ||
      !("provider" in body) ||
      body.provider !== "google" ||
      !("id_token" in body) ||
      typeof body.id_token !== "string" ||
      !("nonce" in body) ||
      typeof body.nonce !== "string"
    ) {
      throw new Error("Invalid ID token exchange");
    }
    const claims = verify(body.id_token);
    if (claims?.["iss"] !== GOOGLE_ISSUER) {
      throw new Error("ID token verification failed");
    }
    if (claims["nonce"] !== crypto.createHash("sha256").update(body.nonce).digest("hex")) {
      throw new Error("ID token nonce mismatch");
    }
    exchanges += 1;
    response.end(sessionFor(nowSeconds(), "id_token"));
  };
  const handler: http.RequestListener = (request, response) => {
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
      if (url.pathname === "/qa/google-id-token" && request.method === "POST") {
        await issueGoogleIdToken(request, response);
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
  };
  const hostname = options.hostname ?? "127.0.0.1";
  const servers =
    hostname === "localhost"
      ? await listenOnBothLoopbacks(handler)
      : [await listen(handler, 0, "127.0.0.1")];
  origin = `http://${hostname}:${portOf(servers[0])}`;
  return {
    origin,
    otherToken: () => tokenFor(OTHER_SUBJECT),
    exchanges: () => exchanges,
    close: async () => {
      await Promise.all(servers.map(close));
    },
  };
}

async function readJson(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

/**
 * Listens on one port at both `127.0.0.1` and `::1`, so `localhost` reaches the provider however a
 * client resolves it. Tries another port when the one assigned on IPv4 is taken on IPv6.
 */
async function listenOnBothLoopbacks(handler: http.RequestListener): Promise<http.Server[]> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const ipv4 = await listen(handler, 0, "127.0.0.1");
    try {
      return [ipv4, await listen(handler, portOf(ipv4), "::1")];
    } catch (error) {
      await close(ipv4);
      if (!(error instanceof Error && "code" in error && error.code === "EADDRINUSE")) {
        throw error;
      }
    }
  }
  throw new Error("No identity port is free on both loopback addresses.");
}

function listen(handler: http.RequestListener, port: number, host: string): Promise<http.Server> {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function portOf(server: http.Server | undefined): number {
  const address = server?.address();
  if (!address || typeof address === "string") {
    throw new Error("No identity port");
  }
  return address.port;
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
