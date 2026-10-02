import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { expect, test } from "vitest";

import { verifyAccountToken } from "#src/account-auth.ts";

const url = "https://cup-test.supabase.co";
const subject = "f355f913-ba12-45d6-a7d2-4df95f7cf11f";

async function fixture() {
  const keys = await generateKeyPair("ES256");
  const publicKey = { ...(await exportJWK(keys.publicKey)), kid: "test" };
  const jwks = createLocalJWKSet({ keys: [publicKey] });
  const token = (issuer = `${url}/auth/v1`, audience = "authenticated", expiry = "5m") =>
    new SignJWT({ role: "authenticated", is_anonymous: false })
      .setProtectedHeader({ alg: "ES256", kid: "test" })
      .setSubject(subject)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expiry)
      .sign(keys.privateKey);
  return { token, jwks };
}

test("accepts a correctly signed account identity", async () => {
  const { token, jwks } = await fixture();
  expect((await verifyAccountToken(await token(), url, jwks)).subject).toBe(subject);
});

test("rejects expired, foreign issuer, foreign audience and forged JWTs", async () => {
  const { token, jwks } = await fixture();
  for (const jwt of [
    await token("https://other.supabase.co/auth/v1"),
    await token(undefined, "service_role"),
    await token(undefined, undefined, "-5m"),
    `${await token()}forged`,
  ]) {
    await expect(verifyAccountToken(jwt, url, jwks)).rejects.toThrow(/./);
  }
});

test("refreshing JWT issuance does not make an earlier Google authentication fresh", async () => {
  const keys = await generateKeyPair("ES256");
  const publicKey = { ...(await exportJWK(keys.publicKey)), kid: "freshness" };
  const token = await new SignJWT({
    role: "authenticated",
    is_anonymous: false,
    email: "test@example.com",
    app_metadata: { provider: "google" },
    amr: [{ method: "oauth", timestamp: 1_700_000_000 }],
  })
    .setProtectedHeader({ alg: "ES256", kid: "freshness" })
    .setSubject(subject)
    .setIssuer(`${url}/auth/v1`)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(keys.privateKey);
  const identity = await verifyAccountToken(token, url, createLocalJWKSet({ keys: [publicKey] }));
  expect(identity.authenticatedAtSeconds).toBe(1_700_000_000);
  expect(identity.googleAuthenticated).toBe(true);
});
