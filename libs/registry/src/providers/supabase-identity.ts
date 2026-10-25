import { z } from "zod";

import type { ProviderRequest } from "#src/providers/provider-request.ts";

export type SupabaseAdminEnvironment = {
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
};

/** Authoritative existence checks prevent expired/deleted identities from allocating accounts. */
export async function verifySupabaseIdentity(env: SupabaseAdminEnvironment, subject: string) {
  z.uuid().parse(subject);
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${subject}`, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    },
  });
  if (response.status === 404) {
    await response.body?.cancel();
    return false;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Supabase identity verification unavailable");
  }
  const user = z.object({ id: z.uuid() }).parse(await response.json());
  if (user.id !== subject) {
    throw new Error("Supabase identity mismatch");
  }
  return true;
}

/** Hard-deletes the identity; an identity that is already gone counts as deleted. */
export async function deleteSupabaseIdentity(
  env: SupabaseAdminEnvironment,
  subject: string,
  { request, timeoutMs }: ProviderRequest,
) {
  const response = await request(`${env.SUPABASE_URL}/auth/v1/admin/users/${subject}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ should_soft_delete: false }),
  });
  await response.body?.cancel();
  if (!response.ok && response.status !== 404) {
    throw new Error("Identity deletion unavailable");
  }
}
