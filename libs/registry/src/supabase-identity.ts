import { z } from "zod";

export type SupabaseAdminEnvironment = {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
};

/** Authoritative existence checks prevent expired/deleted identities from allocating accounts. */
export async function verifySupabaseIdentity(env: SupabaseAdminEnvironment, subject: string) {
  z.uuid().parse(subject);
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY)
    throw new Error("Supabase administration is not configured");
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
  if (user.id !== subject) throw new Error("Supabase identity mismatch");
  return true;
}
