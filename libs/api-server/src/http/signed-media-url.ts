import { conversionOwnerSchema, type ConversionOwner } from "@cup/conversion-contracts";

/**
 * Who a signed media URL was issued to: the account or the grant that owned the audiobook when the
 * URL was issued. Delivery checks this principal's current access on every request.
 */
export type MediaUrlPrincipal = ConversionOwner;

export type MediaUrlTokenVerification =
  | { result: "absent" }
  | { result: "invalid" }
  | { result: "valid"; principal: MediaUrlPrincipal };

/** How long a signed media URL authorizes requests after it was issued. */
const SIGNED_MEDIA_URL_LIFETIME_MS = 24 * 60 * 60 * 1_000;

const TOKEN_QUERY_PARAMETER = "token";
const TOKEN_VERSION = "v1";

/**
 * Appends a `token` query parameter that authorizes requests to `url` for one audiobook and one
 * principal, until {@link SIGNED_MEDIA_URL_LIFETIME_MS} after `issuedAtMs`. The token is stateless:
 * rotating `signingKey` invalidates every outstanding URL.
 */
export async function signMediaUrl({
  url,
  conversionId,
  principal,
  signingKey,
  issuedAtMs,
}: {
  url: string;
  conversionId: string;
  principal: MediaUrlPrincipal;
  signingKey: string;
  issuedAtMs: number;
}): Promise<string> {
  const payload = encodeBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        conversionId,
        principal,
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
 * Checks the `token` query parameter of a request for `conversionId`: its signature, its expiry,
 * and that it was issued for this audiobook. The principal's current access is not checked here.
 */
export async function verifyMediaUrlToken({
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
