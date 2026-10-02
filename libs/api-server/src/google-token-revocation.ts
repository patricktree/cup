import { z } from "zod";

import type { ApiServerEnvironment } from "#src/api-server-environment.ts";

export async function revokeVerifiedGoogleToken(
  env: ApiServerEnvironment,
  subject: string,
  token: string,
) {
  const userResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${subject}`, {
    signal: AbortSignal.timeout(5_000),
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    },
  });
  if (!userResponse.ok) {
    await userResponse.body?.cancel();
    return false;
  }
  const user = z
    .object({
      id: z.uuid(),
      identities: z.array(
        z.object({
          provider: z.string(),
          identity_data: z.object({ sub: z.string() }).passthrough(),
        }),
      ),
    })
    .parse(await userResponse.json());
  const google = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    signal: AbortSignal.timeout(5_000),
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!google.ok) {
    await google.body?.cancel();
    return false;
  }
  const identity = z.object({ sub: z.string() }).parse(await google.json());
  if (
    user.id !== subject ||
    !user.identities.some(
      (item) => item.provider === "google" && item.identity_data.sub === identity.sub,
    )
  )
    return false;
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    signal: AbortSignal.timeout(5_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  await response.body?.cancel();
  return response.ok;
}
