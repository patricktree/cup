/**
 * Every query key, grouped by the owner of the server data, so an API write invalidates everything
 * it may change by one key prefix. Queries and cache edits build keys only here.
 */
export const QUERY_KEYS = {
  /** Every query of the signed-in account's data; `undefined` while no account is signed in. */
  account: (subject: string | undefined) => ["account", subject] as const,
  accountSnapshot: (subject: string | undefined) =>
    [...QUERY_KEYS.account(subject), "snapshot"] as const,
  accountHistory: (subject: string | undefined) =>
    [...QUERY_KEYS.account(subject), "history"] as const,
  audiobook: (conversionId: string) => ["audiobook", conversionId] as const,
  grant: (grantId: string) => ["conversion-grant", grantId] as const,
};
