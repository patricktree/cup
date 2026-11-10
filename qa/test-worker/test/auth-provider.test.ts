import crypto from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";

import { startAuthProvider } from "#src/auth-provider.ts";

let authProvider: Awaited<ReturnType<typeof startAuthProvider>> | undefined;

beforeAll(async () => {
  authProvider = await startAuthProvider({ hostname: "localhost" });
});

afterAll(async () => {
  await authProvider?.close();
});

test("is reachable at localhost over IPv4 and IPv6 and issues its tokens there", async () => {
  const { origin } = startedAuthProvider();
  expect(origin).toMatch(/^http:\/\/localhost:\d+$/);
  const { port } = new URL(origin);
  for (const loopback of ["127.0.0.1", "[::1]"]) {
    const response = await fetch(`http://${loopback}:${port}/auth/v1/.well-known/jwks.json`);
    expect(response.status).toBe(200);
  }

  const session = await exchangeIdToken(await googleIdToken(hash("the nonce")), "the nonce");
  expect(session.status).toBe(200);
  expect(issuerOf(await session.json())).toBe(`${origin}/auth/v1`);
});

test("rejects an ID token exchange whose nonce does not match the token's", async () => {
  const idToken = await googleIdToken(hash("the nonce"));

  const response = await exchangeIdToken(idToken, "another nonce");

  expect(response.status).toBe(400);
});

test.each(["audio.cup.app://auth/callback", "http://127.0.0.1:5173/app/"])(
  "sends a PKCE authorization's code to %s, where it exchanges for a session",
  async (redirect) => {
    const verifier = "the code verifier";

    const response = await authorize(redirect, hashForPkce(verifier));

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.href.startsWith(redirect)).toBe(true);
    const session = await fetch(`${startedAuthProvider().origin}/auth/v1/token?grant_type=pkce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth_code: location.searchParams.get("code"),
        code_verifier: verifier,
      }),
    });
    expect(session.status).toBe(200);
  },
);

test.each(["audio.cup.app://share", "https://attacker.example/auth/callback"])(
  "refuses a PKCE authorization that redirects to %s",
  async (redirect) => {
    const response = await authorize(redirect, hashForPkce("the code verifier"));

    expect(response.status).toBe(400);
  },
);

/** The request supabase-js `signInWithOAuth` sends the browser to, with the S256 challenge. */
function authorize(redirect: string, challenge: string): Promise<Response> {
  const url = new URL(`${startedAuthProvider().origin}/auth/v1/authorize`);
  url.search = new URLSearchParams({
    provider: "google",
    redirect_to: redirect,
    code_challenge: challenge,
    code_challenge_method: "s256",
  }).toString();
  return fetch(url, { redirect: "manual" });
}

function hashForPkce(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function startedAuthProvider() {
  if (authProvider === undefined) {
    throw new Error("The fake auth provider has not started.");
  }
  return authProvider;
}

/** What the Android debug build's sign-in fake asks for, with the hashed nonce it was given. */
async function googleIdToken(hashedNonce: string): Promise<string> {
  const response = await fetch(`${startedAuthProvider().origin}/qa/google-id-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nonce: hashedNonce }),
  });
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  if (!isRecord(body) || typeof body["idToken"] !== "string") {
    throw new Error("The fake auth provider returned no ID token.");
  }
  return body["idToken"];
}

/** The request supabase-js `signInWithIdToken` sends, with the raw nonce. */
function exchangeIdToken(idToken: string, nonce: string): Promise<Response> {
  return fetch(`${startedAuthProvider().origin}/auth/v1/token?grant_type=id_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "google", id_token: idToken, nonce }),
  });
}

function hash(nonce: string): string {
  return crypto.createHash("sha256").update(nonce).digest("hex");
}

function issuerOf(session: unknown): unknown {
  if (!isRecord(session) || typeof session["access_token"] !== "string") {
    throw new Error("The exchange returned no access token.");
  }
  const payload: unknown = JSON.parse(
    Buffer.from(session["access_token"].split(".")[1] ?? "", "base64url").toString(),
  );
  return isRecord(payload) ? payload["iss"] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
