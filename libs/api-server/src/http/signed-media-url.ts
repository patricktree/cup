import { Temporal } from "temporal-polyfill";

import { conversionOwnerSchema, type ConversionOwner } from "@cup/conversion-contracts";
import type { GrantState } from "@cup/conversion-grants";

import type { ApiServerEnvironment } from "#src/api-server-environment.ts";
import { accountAuthError, jsonError, requireAccessibleGrantState } from "#src/http/http-errors.ts";

/**
 * Who a signed media URL was issued to: the account or the grant that owned the audiobook when the
 * URL was issued. Delivery checks this principal's current access on every request.
 */
export type MediaUrlPrincipal = ConversionOwner;

const DAY_MS = 24 * 60 * 60 * 1_000;
/**
 * How long a signed media URL authorizes requests after its issue time, the start of the UTC day it
 * was handed out on. Every URL therefore stays valid for at least 24 hours after it is handed out.
 */
const SIGNED_MEDIA_URL_LIFETIME_MS = 2 * DAY_MS;

const TOKEN_QUERY_PARAMETER = "token";
const TOKEN_VERSION = "v1";

/** A media route under `/api/files/audiobooks/{conversionId}/`. */
type AudiobookMediaResource = "cover-image" | "narration-track.mp3";

/** Signs media URLs on the request's origin for one principal, which must have access. */
export function createMediaUrlSigner(
  context: { req: { url: string }; env: { MEDIA_URL_SIGNING_KEY: string } },
  principal: MediaUrlPrincipal,
): (conversionId: string, resource: AudiobookMediaResource) => Promise<string> {
  return (conversionId, resource) =>
    signAudiobookMediaUrl({
      requestUrl: context.req.url,
      signingKey: context.env.MEDIA_URL_SIGNING_KEY,
      conversionId,
      principal,
      resource,
    });
}

/** Issues the signed media URL of one media resource of an audiobook, on the request's origin. */
function signAudiobookMediaUrl({
  requestUrl,
  signingKey,
  conversionId,
  principal,
  resource,
}: {
  requestUrl: string;
  signingKey: string;
  conversionId: string;
  principal: MediaUrlPrincipal;
  resource: AudiobookMediaResource;
}): Promise<string> {
  return signMediaUrl({
    url: `${new URL(requestUrl).origin}/api/files/audiobooks/${conversionId}/${resource}`,
    conversionId,
    principal,
    signingKey,
    nowMs: Temporal.Now.instant().epochMilliseconds,
  });
}

/**
 * Appends a `token` query parameter that authorizes requests to `url` for one audiobook and one
 * principal, until {@link SIGNED_MEDIA_URL_LIFETIME_MS} after the start of the UTC day of `nowMs`.
 * Within one UTC day, the same URL and principal therefore get a byte-identical URL, which lets
 * browsers cache cover images (ADR 0013). The token is stateless: rotating `signingKey` invalidates
 * every outstanding URL.
 */
export async function signMediaUrl({
  url,
  conversionId,
  principal,
  signingKey,
  nowMs,
}: {
  url: string;
  conversionId: string;
  principal: MediaUrlPrincipal;
  signingKey: string;
  nowMs: number;
}): Promise<string> {
  const issuedAtMs = nowMs - (nowMs % DAY_MS);
  const payload = encodeBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        conversionId,
        // Rebuilt in a fixed key order, so equal principals always encode to the same token.
        principal:
          principal.kind === "account"
            ? { kind: principal.kind, accountId: principal.accountId }
            : { kind: principal.kind, grantId: principal.grantId },
        expiresAtMs: issuedAtMs + SIGNED_MEDIA_URL_LIFETIME_MS,
      }),
    ),
  );
  const signature = encodeBase64Url(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await importSigningKey(signingKey),
        new TextEncoder().encode(payload),
      ),
    ),
  );

  const signedUrl = new URL(url);
  signedUrl.searchParams.set(TOKEN_QUERY_PARAMETER, `${TOKEN_VERSION}.${payload}.${signature}`);
  return signedUrl.href;
}

/**
 * Authorizes a media request by its signed media URL token, the only credential media routes
 * accept. Without an owner, the route answers its own not-found response.
 */
export async function requireSignedMediaUrl(
  env: ApiServerEnvironment,
  requestUrl: string,
  conversionId: string,
  owner: ConversionOwner | undefined,
  requestId: string,
): Promise<Response | undefined> {
  const token = await verifyMediaUrlToken({
    requestUrl,
    conversionId,
    signingKey: env.MEDIA_URL_SIGNING_KEY,
    nowMs: Temporal.Now.instant().epochMilliseconds,
  });
  if (token.result !== "valid") {
    return jsonError(
      requestId,
      "media-url-invalid",
      "The media URL is invalid or expired. Reload the audiobook.",
      401,
    );
  }
  if (!owner) {
    return undefined;
  }
  return requireSignedMediaAccess(env, owner, token.principal, requestId);
}

/**
 * Runs the authoritative checks behind a signed media URL whose signature and expiry are valid: the
 * principal must still own the audiobook, as an active account or an unexpired, unrevoked grant.
 * Denials answer as the same request with the account's or grant's own credentials would.
 */
async function requireSignedMediaAccess(
  env: ApiServerEnvironment,
  owner: ConversionOwner,
  principal: MediaUrlPrincipal,
  requestId: string,
): Promise<Response | undefined> {
  if (owner.kind === "account") {
    if (principal.kind !== "account" || principal.accountId !== owner.accountId) {
      return jsonError(requestId, "audiobook-not-found", "Audiobook not found.", 404);
    }
    const account = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(owner.accountId));
    if ((await account.inspect()).state !== "active") {
      return accountAuthError("blocked", requestId);
    }
    return undefined;
  }

  if (principal.kind !== "trial" || principal.grantId !== owner.grantId) {
    return jsonError(
      requestId,
      "grant-session-required",
      "Open the original trial link to access this audiobook.",
      401,
    );
  }
  let grantState: GrantState;
  try {
    grantState = (
      await env.CONVERSION_GRANTS.get(env.CONVERSION_GRANTS.idFromName(owner.grantId)).inspect()
    ).state;
  } catch {
    return jsonError(requestId, "operational-error", "The grant could not be loaded.", 500);
  }
  return requireAccessibleGrantState(grantState, requestId);
}

type MediaUrlTokenVerification =
  | { result: "absent" }
  | { result: "invalid" }
  | { result: "valid"; principal: MediaUrlPrincipal };

/**
 * Checks the `token` query parameter of a request for `conversionId`: its signature, its expiry,
 * and that it was issued for this audiobook. The principal's current access is not checked here.
 */
async function verifyMediaUrlToken({
  requestUrl,
  conversionId,
  signingKey,
  nowMs,
}: {
  requestUrl: string;
  conversionId: string;
  signingKey: string;
  nowMs: number;
}): Promise<MediaUrlTokenVerification> {
  const token = new URL(requestUrl).searchParams.get(TOKEN_QUERY_PARAMETER);
  if (token === null) {
    return { result: "absent" };
  }

  const [version, payload, signature, ...rest] = token.split(".");
  if (
    version !== TOKEN_VERSION ||
    payload === undefined ||
    signature === undefined ||
    rest.length > 0
  ) {
    return { result: "invalid" };
  }

  let signatureBytes: Uint8Array<ArrayBuffer>;
  let claims: unknown;
  try {
    signatureBytes = decodeBase64Url(signature);
    claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
  } catch {
    return { result: "invalid" };
  }

  // `verify` compares in constant time.
  const isAuthentic = await crypto.subtle.verify(
    "HMAC",
    await importSigningKey(signingKey),
    signatureBytes,
    new TextEncoder().encode(payload),
  );
  if (!isAuthentic || !isRecord(claims)) {
    return { result: "invalid" };
  }

  const principal = conversionOwnerSchema.safeParse(claims["principal"]);
  const expiresAtMs = claims["expiresAtMs"];
  if (
    claims["conversionId"] !== conversionId ||
    !principal.success ||
    typeof expiresAtMs !== "number" ||
    nowMs >= expiresAtMs
  ) {
    return { result: "invalid" };
  }
  return { result: "valid", principal: principal.data };
}

function importSigningKey(signingKey: string): Promise<CryptoKey> {
  if (signingKey === "") {
    throw new Error("MEDIA_URL_SIGNING_KEY must not be empty.");
  }
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** Throws for input that is not base64url. */
function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new Error("Invalid base64url value");
  }
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
