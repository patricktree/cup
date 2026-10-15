import { decodeBase64Url, encodeBase64Url } from "#src/encoding.ts";
import type { GrantRecord } from "#src/grant-model.ts";

const SESSION_COOKIE_LIFETIME_SECONDS = 400 * 24 * 60 * 60;

export const GRANT_SESSION_COOKIE_NAME = "__Secure-grant-session";
export const GRANT_SESSION_MAX_AGE_SECONDS = SESSION_COOKIE_LIFETIME_SECONDS;

export async function createRootCredential(): Promise<{ credential: string; verifier: string }> {
  const credential = `v1.${encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
  return { credential, verifier: await hashCredential(credential) };
}

export async function verifyRootCredential(credential: string, verifier: string): Promise<boolean> {
  return constantTimeEqual(await hashCredential(credential), verifier);
}

export function createGrantSessionCookie(grantId: string, token: string): string {
  return `${grantSessionCookieName(grantId)}=${token}; Path=/api; Secure; HttpOnly; SameSite=Lax; Max-Age=${SESSION_COOKIE_LIFETIME_SECONDS}`;
}

export function clearGrantSessionCookie(grantId: string): string {
  return `${grantSessionCookieName(grantId)}=; Path=/api; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function getGrantSessionCookie(
  cookieHeader: string | undefined,
  grantId: string,
): string | undefined {
  if (cookieHeader === undefined) {
    return undefined;
  }
  const cookieName = grantSessionCookieName(grantId);
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
}

function grantSessionCookieName(grantId: string): string {
  return `${GRANT_SESSION_COOKIE_NAME}-${grantId}`;
}

async function hashCredential(credential: string): Promise<string> {
  return encodeBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential))),
  );
}

export async function signSession(record: GrantRecord, issuedAtMs: number): Promise<string> {
  const payload = encodeBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        v: 1,
        grantId: record.grantId,
        nonce: encodeBase64Url(crypto.getRandomValues(new Uint8Array(16))),
        issuedAtMs,
      }),
    ),
  );
  const signature = await sign(record.sessionSigningKey, payload);
  return `v1.${payload}.${signature}`;
}

export async function verifySession(
  record: GrantRecord,
  token: string,
  nowMs: number,
): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || parts[1] === undefined || parts[2] === undefined) {
    return false;
  }
  const expected = await sign(record.sessionSigningKey, parts[1]);
  if (!constantTimeEqual(expected, parts[2])) {
    return false;
  }
  try {
    const payload: unknown = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
    return (
      isRecord(payload) &&
      payload["v"] === 1 &&
      payload["grantId"] === record.grantId &&
      typeof payload["nonce"] === "string" &&
      typeof payload["issuedAtMs"] === "number" &&
      Number.isSafeInteger(payload["issuedAtMs"]) &&
      payload["issuedAtMs"] <= nowMs &&
      nowMs - payload["issuedAtMs"] <= SESSION_COOKIE_LIFETIME_SECONDS * 1_000
    );
  } catch {
    return false;
  }
}

async function sign(key: string, payload: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(decodeBase64Url(key)).buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return encodeBase64Url(
    new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(payload))),
  );
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
