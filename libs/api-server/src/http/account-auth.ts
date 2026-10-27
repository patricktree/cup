import { createRemoteJWKSet, errors, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";

import type { ApiServerEnvironment } from "#src/api-server-environment.ts";
import { ingressIdentity } from "#src/http/ingress-identity.ts";
import { authenticateAccount as authenticateVerifiedAccount } from "#src/use-cases/authenticate-account.ts";

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** The email and password account that local development offers instead of Google sign-in. */
export type LocalTestAccount = { email: string; password: string };

/** Never offered or accepted unless the Worker runs with `LOCAL_DEVELOPMENT=true`; see ADR 0011. */
export function localTestAccount(env: ApiServerEnvironment): LocalTestAccount | undefined {
  if (
    env.LOCAL_DEVELOPMENT !== "true" ||
    !env.LOCAL_TEST_ACCOUNT_EMAIL ||
    !env.LOCAL_TEST_ACCOUNT_PASSWORD
  ) {
    return undefined;
  }
  return { email: env.LOCAL_TEST_ACCOUNT_EMAIL, password: env.LOCAL_TEST_ACCOUNT_PASSWORD };
}

/**
 * Validate access locally; Cup lifecycle checks remain authoritative for account access. Only
 * Google identities are accepted, plus the local test account when `testAccountEmail` is given.
 */
export async function verifyAccountToken(
  token: string,
  { supabaseUrl, testAccountEmail }: { supabaseUrl: string; testAccountEmail?: string | undefined },
  getKey?: JWTVerifyGetKey,
) {
  const issuer = `${supabaseUrl.replace(/\/$/, "")}/auth/v1`;
  let keys: JWTVerifyGetKey | undefined = getKey ?? keySets.get(issuer);
  if (!keys) {
    const remote = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    keySets.set(issuer, remote);
    keys = remote;
  }
  const { payload } = await jwtVerify(token, keys, {
    issuer,
    audience: "authenticated",
    algorithms: ["ES256", "RS256"],
  });
  if (
    !payload.sub ||
    !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(payload.sub) ||
    payload["role"] !== "authenticated" ||
    payload["is_anonymous"] === true ||
    typeof payload.exp !== "number" ||
    typeof payload.iat !== "number"
  ) {
    throw new errors.JWTClaimValidationFailed("Invalid account identity", payload);
  }
  const metadata = payload["app_metadata"];
  const provider =
    !!metadata && typeof metadata === "object" && "provider" in metadata
      ? metadata.provider
      : undefined;
  const isTestAccount =
    testAccountEmail !== undefined && provider === "email" && payload["email"] === testAccountEmail;
  if (provider !== "google" && !isTestAccount) {
    throw new errors.JWTClaimValidationFailed("Unsupported sign-in provider", payload);
  }
  // Fresh authentication counts only the method of the identity's own provider.
  const freshMethods = isTestAccount ? ["password"] : ["oauth", "id_token"];
  const amr = payload["amr"];
  const authenticatedAtSeconds = Array.isArray(amr)
    ? Math.max(
        0,
        ...amr.flatMap((entry: unknown) => {
          if (
            !entry ||
            typeof entry !== "object" ||
            !("method" in entry) ||
            !("timestamp" in entry)
          ) {
            return [];
          }
          return freshMethods.includes(String(entry.method)) && typeof entry.timestamp === "number"
            ? [entry.timestamp]
            : [];
        }),
      )
    : 0;
  return {
    provider: isTestAccount ? ("test-account" as const) : ("google" as const),
    subject: payload.sub,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
    authenticatedAtSeconds,
    email: typeof payload["email"] === "string" ? payload["email"] : undefined,
  };
}

export async function authenticateAccountRequest(request: Request, env: ApiServerEnvironment) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return { result: "unauthorized" } as const;
  }
  let identity: Awaited<ReturnType<typeof verifyAccountToken>>;
  try {
    identity = await verifyAccountToken(authorization.slice(7), {
      supabaseUrl: env.SUPABASE_URL,
      testAccountEmail: localTestAccount(env)?.email,
    });
  } catch (error) {
    return {
      result:
        error instanceof errors.JOSEError && !(error instanceof errors.JWKSTimeout)
          ? "unauthorized"
          : "unavailable",
    } as const;
  }
  try {
    const accounts = env.ACCOUNTS;
    const result = await authenticateVerifiedAccount(identity.subject, {
      registry: env.REGISTRY.get(env.REGISTRY.idFromName("registry")),
      getIngressIdentity: () => ingressIdentity(request, env.LOCAL_DEVELOPMENT === "true"),
      getAccount: (accountId) => accounts.get(accounts.idFromName(accountId)),
    });
    return result.result === "authenticated" ? { ...result, identity } : result;
  } catch {
    return { result: "unavailable" } as const;
  }
}

export function mediaRequest(request: Request): Request {
  if (request.headers.has("Authorization")) {
    return request;
  }
  const value = request.headers
    .get("Cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("cup_media="))
    ?.slice(10);
  if (!value) {
    return request;
  }
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${value}`);
  return new Request(request.url, { method: request.method, headers });
}

export function mediaCookie(request: Request, token: string, maxAge: number) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `cup_media=${token}; Path=/api/files; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}
