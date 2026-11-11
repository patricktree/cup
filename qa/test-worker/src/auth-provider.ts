import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import type net from "node:net";
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
/** Where the iOS app's sign-in sheet returns to Cup, as Supabase's redirect allow-list holds it. */
const IOS_AUTH_CALLBACK_URL = "audio.cup.app://auth/callback";
/** The Supabase Auth API version whose error shape the provider answers with when asked for it. */
const SUPABASE_API_VERSION = "2024-01-01";
const DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS = 300;
/** Supabase's default `refresh_token_reuse_interval`, which `supabase/config.toml` keeps. */
const DEFAULT_REFRESH_TOKEN_REUSE_INTERVAL_SECONDS = 10;
/**
 * The local test account that the password grant signs in; a test Worker started with
 * `offersTestAccount` advertises it, as local development does.
 */
export const TEST_ACCOUNT = { email: "test-account@example.test", password: "qa-test-account" };
const TEST_ACCOUNT_SUBJECT = "c5a2b1e4-0f3d-4b8e-9a6c-2d7e1f4b9a30";
const nowMilliseconds = () => Temporal.Now.instant().epochMilliseconds;
const nowSeconds = () => Math.floor(nowMilliseconds() / 1000);

type StartAuthProviderOptions = {
  /**
   * The host in the provider's origin, which is also in its token issuer. `localhost` makes it
   * listen on both the IPv4 and the IPv6 loopback, wherever a client resolves `localhost` to.
   */
  hostname?: "127.0.0.1" | "localhost";
  /**
   * Serves HTTPS with this key and certificate instead of HTTP. The web suite passes the Worker's
   * certificate, because WebKit blocks an HTTPS page from calling HTTP.
   */
  tls?: { key: Buffer; cert: Buffer };
};

/** A running fake auth provider, as tests of every suite read and configure it. */
export type AuthProvider = Awaited<ReturnType<typeof startAuthProvider>>;

/**
 * The sign-in a session belongs to; a refresh keeps it, as Supabase keeps a session's `amr`. A
 * password sign-in is the test account's, any other the Google account's.
 */
type SignIn = { authenticatedAt: number; method: "oauth" | "id_token" | "password" };

/** The session a refresh token's single use issued, and when, in epoch milliseconds. */
type Rotation = { session: string; rotatedAt: number };

/**
 * Local identity boundary: real PKCE, a Google ID token exchange with Supabase's nonce check, the
 * test account's password sign-in, signed access tokens and JWKS, with no Google traffic.
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
  /**
   * Every refresh token issued, kept after its single use with the session that use issued, so a
   * reuse within the reuse interval gets that session again and a later reuse is told apart from a
   * typo.
   */
  const refreshTokens = new Map<string, SignIn & { rotation?: Rotation }>();
  /** The query parameters of each authorization request, also of a rejected one. */
  const authorizationRequests: Array<Record<string, string>> = [];
  let origin = "";
  let exchanges = 0;
  let refreshes = 0;
  let accessTokenLifetimeSeconds = DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS;
  let refreshTokenReuseIntervalSeconds = DEFAULT_REFRESH_TOKEN_REUSE_INTERVAL_SECONDS;
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
    method: SignIn["method"] = "oauth",
  ) => {
    const now = nowSeconds();
    return sign({
      iss: `${origin}/auth/v1`,
      sub: subject,
      aud: "authenticated",
      role: "authenticated",
      email: method === "password" ? TEST_ACCOUNT.email : "reader@example.test",
      iat: now,
      exp: now + accessTokenLifetimeSeconds,
      app_metadata: { provider: method === "password" ? "email" : "google" },
      amr: [{ method, timestamp: authenticatedAt }],
    });
  };
  /**
   * The session that the PKCE, the ID token, the password and the refresh token exchange return,
   * with a new single-use refresh token: the Google account's, or the test account's after a
   * password sign-in.
   */
  const sessionFor = ({ authenticatedAt, method }: SignIn) => {
    const refreshToken = crypto.randomUUID();
    refreshTokens.set(refreshToken, { authenticatedAt, method });

    const account =
      method === "password"
        ? {
            id: TEST_ACCOUNT_SUBJECT,
            email: TEST_ACCOUNT.email,
            provider: "email",
            metadata: {},
            identitySubject: TEST_ACCOUNT_SUBJECT,
          }
        : {
            id: SUBJECT,
            email: "reader@example.test",
            provider: "google",
            metadata: { name: READER_NAME, full_name: READER_NAME },
            identitySubject: GOOGLE_SUBJECT,
          };

    return JSON.stringify({
      access_token: tokenFor(account.id, authenticatedAt, method),
      token_type: "bearer",
      refresh_token: refreshToken,
      expires_in: accessTokenLifetimeSeconds,
      user: {
        id: account.id,
        email: account.email,
        aud: "authenticated",
        app_metadata: { provider: account.provider },
        user_metadata: account.metadata,
        identities: [
          { provider: account.provider, identity_data: { sub: account.identitySubject } },
        ],
      },
    });
  };
  const authorize = (url: URL, response: http.ServerResponse) => {
    authorizationRequests.push(Object.fromEntries(url.searchParams));
    const redirect = new URL(url.searchParams.get("redirect_to") ?? "");
    if (
      url.searchParams.get("provider") !== "google" ||
      url.searchParams.get("code_challenge_method")?.toLowerCase() !== "s256" ||
      !isAllowedRedirect(redirect)
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
    if (url.searchParams.get("grant_type") === "refresh_token") {
      exchangeRefreshToken(body, request, response);
      return;
    }
    if (url.searchParams.get("grant_type") === "password") {
      exchangePassword(body, request, response);
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
    response.end(sessionFor({ authenticatedAt: code.authenticatedAt, method: "oauth" }));
  };
  /**
   * Exchanges a refresh token for a new session of the same sign-in, once. As Supabase does, a
   * reuse within the reuse interval returns the session the first use issued, such as when a page
   * reloads during a refresh and its storage still holds the old token; a later reuse is rejected.
   */
  const exchangeRefreshToken = (
    body: unknown,
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) => {
    if (
      !body ||
      typeof body !== "object" ||
      !("refresh_token" in body) ||
      typeof body.refresh_token !== "string"
    ) {
      throw new Error("Invalid refresh token exchange");
    }
    const signIn = refreshTokens.get(body.refresh_token);
    if (signIn === undefined) {
      rejectAsSupabase(request, response, {
        errorCode: "refresh_token_not_found",
        message: "Invalid Refresh Token: Refresh Token Not Found",
      });
      return;
    }
    const { rotation } = signIn;
    if (rotation !== undefined) {
      if (nowMilliseconds() - rotation.rotatedAt <= refreshTokenReuseIntervalSeconds * 1000) {
        response.end(rotation.session);
        return;
      }

      rejectAsSupabase(request, response, {
        errorCode: "refresh_token_already_used",
        message: "Invalid Refresh Token: Already Used",
      });
      return;
    }

    const session = sessionFor(signIn);
    signIn.rotation = { session, rotatedAt: nowMilliseconds() };
    refreshes += 1;
    response.end(session);
  };
  /** Signs in the test account, the only account with a password, as Supabase's email provider. */
  const exchangePassword = (
    body: unknown,
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) => {
    if (
      !body ||
      typeof body !== "object" ||
      !("email" in body) ||
      !("password" in body) ||
      body.email !== TEST_ACCOUNT.email ||
      body.password !== TEST_ACCOUNT.password
    ) {
      rejectAsSupabase(request, response, {
        errorCode: "invalid_credentials",
        message: "Invalid login credentials",
      });
      return;
    }
    exchanges += 1;
    response.end(sessionFor({ authenticatedAt: nowSeconds(), method: "password" }));
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
    response.end(sessionFor({ authenticatedAt: nowSeconds(), method: "id_token" }));
  };
  const handler: http.RequestListener = (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
    );
    // supabase-js reads an error's code from the shape this header names, also in a browser.
    response.setHeader("Access-Control-Expose-Headers", "X-Supabase-Api-Version");
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
        if (id === SUBJECT || id === OTHER_SUBJECT || id === TEST_ACCOUNT_SUBJECT) {
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
  const { tls } = options;
  const createServer = (): net.Server =>
    tls === undefined ? http.createServer(handler) : https.createServer(tls, handler);
  const hostname = options.hostname ?? "127.0.0.1";
  const servers =
    hostname === "localhost"
      ? await listenOnBothLoopbacks(createServer)
      : [await listen(createServer, 0, "127.0.0.1")];
  origin = `${options.tls === undefined ? "http" : "https"}://${hostname}:${portOf(servers[0])}`;
  return {
    origin,
    otherToken: () => tokenFor(OTHER_SUBJECT),
    /**
     * The query parameters of every authorization request so far, in order, such as the `prompt`
     * and `max_age` Cup asked Google for.
     */
    authorizationRequests: () => authorizationRequests.map((query) => ({ ...query })),
    /** How many sign-ins exchanged a PKCE code, an ID token or a password for a session. */
    exchanges: () => exchanges,
    /**
     * How many refresh tokens exchanged for a new session; a reuse within the reuse interval, which
     * returns a session already issued, does not count.
     */
    refreshes: () => refreshes,
    /**
     * Sets how long the access tokens of sessions issued from now on stay valid, 300 seconds by
     * default; a test shortens it so a session refreshes within the test's time budget.
     */
    setAccessTokenLifetime: (seconds: number) => {
      if (!Number.isInteger(seconds) || seconds <= 0) {
        throw new Error(`An access token lifetime must be a positive whole number: ${seconds}`);
      }
      accessTokenLifetimeSeconds = seconds;
    },
    /**
     * Sets how long after its first use a refresh token still returns the session that use issued,
     * 10 seconds by default as in Supabase; a test shortens it to see a later reuse rejected.
     */
    setRefreshTokenReuseInterval: (seconds: number) => {
      if (!Number.isFinite(seconds) || seconds < 0) {
        throw new Error(
          `A refresh token reuse interval must be a non-negative number of seconds: ${seconds}`,
        );
      }

      refreshTokenReuseIntervalSeconds = seconds;
    },
    close: async () => {
      await Promise.all(servers.map(close));
    },
  };
}

/**
 * The redirects the provider sends a code to: a page of the web suite's app on `127.0.0.1`, or the
 * iOS app's callback URL, which its `ASWebAuthenticationSession` catches.
 */
function isAllowedRedirect(redirect: URL): boolean {
  return (
    redirect.hostname === "127.0.0.1" ||
    `${redirect.protocol}//${redirect.host}${redirect.pathname}` === IOS_AUTH_CALLBACK_URL
  );
}

/**
 * Answers with the 400 error body Supabase Auth sends: the API version 2024-01-01 shape when the
 * client asks for it, as supabase-js does, and the legacy shape otherwise.
 */
function rejectAsSupabase(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  { errorCode, message }: { errorCode: string; message: string },
) {
  const apiVersion = request.headers["x-supabase-api-version"];
  if (typeof apiVersion === "string" && apiVersion >= SUPABASE_API_VERSION) {
    response.setHeader("X-Supabase-Api-Version", SUPABASE_API_VERSION);
    response.writeHead(400).end(JSON.stringify({ code: errorCode, message }));
    return;
  }
  response.writeHead(400).end(JSON.stringify({ code: 400, error_code: errorCode, msg: message }));
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
async function listenOnBothLoopbacks(createServer: () => net.Server): Promise<net.Server[]> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const ipv4 = await listen(createServer, 0, "127.0.0.1");
    try {
      return [ipv4, await listen(createServer, portOf(ipv4), "::1")];
    } catch (error) {
      await close(ipv4);
      if (!(error instanceof Error && "code" in error && error.code === "EADDRINUSE")) {
        throw error;
      }
    }
  }
  throw new Error("No identity port is free on both loopback addresses.");
}

function listen(createServer: () => net.Server, port: number, host: string): Promise<net.Server> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function portOf(server: net.Server | undefined): number {
  const address = server?.address();
  if (!address || typeof address === "string") {
    throw new Error("No identity port");
  }
  return address.port;
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
