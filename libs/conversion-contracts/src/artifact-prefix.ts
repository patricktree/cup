import type { ConversionOwner } from "#src/index.ts";

export function createAccountArtifactPrefix(accountId: string): string {
  return `accounts/${accountId}/`;
}

/** Omitting the owner preserves the trial storage layout used by production defaults. */
export function createConversionArtifactPrefix(
  conversionId: string,
  owner?: ConversionOwner,
): string {
  const root =
    owner?.kind === "account" ? createAccountConversionsPrefix(owner.accountId) : "conversions/";
  return `${root}${conversionId}/`;
}

/** Recognizes this account's conversion prefix, including nested execution artifacts. */
export function getAccountConversionIdFromArtifactPrefix(
  prefix: string,
  accountId: string,
): string | undefined {
  const root = createAccountConversionsPrefix(accountId);
  if (!prefix.startsWith(root)) return undefined;
  return /^([0-9a-f-]{36})\//.exec(prefix.slice(root.length))?.[1];
}

function createAccountConversionsPrefix(accountId: string): string {
  return `${createAccountArtifactPrefix(accountId)}conversions/`;
}
