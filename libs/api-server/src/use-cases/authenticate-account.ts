import type { AccountSnapshot } from "@cup/accounts";

export type AuthenticateAccountDependencies<Account> = {
  registry: {
    findIdentity(subject: string): Promise<{ accountId: string; phase: string } | undefined>;
    provisionFromIngress(
      subject: string,
      key: string,
    ): Promise<
      | { result: "rate-limited"; retryAfter: number }
      | { result: "provisioned"; snapshot: AccountSnapshot }
    >;
    provisionVerifiedIdentity(subject: string): Promise<AccountSnapshot>;
  };
  getIngressIdentity(): Promise<string | undefined>;
  getAccount(accountId: string): Account;
};

/** Resolve a verified identity, provisioning or resuming its account when necessary. */
export async function authenticateAccount<Account extends { inspect(): Promise<AccountSnapshot> }>(
  subject: string,
  dependencies: AuthenticateAccountDependencies<Account>,
) {
  try {
    const { registry } = dependencies;
    const mapping = await registry.findIdentity(subject);
    if (!mapping || mapping.phase === "provisioning") {
      let snapshot;
      if (!mapping) {
        const key = await dependencies.getIngressIdentity();
        if (!key) return { result: "unavailable" } as const;
        const provision = await registry.provisionFromIngress(subject, key);
        if (provision.result === "rate-limited")
          return { result: "rate-limited", retryAfter: provision.retryAfter } as const;
        snapshot = provision.snapshot;
      } else snapshot = await registry.provisionVerifiedIdentity(subject);
      return {
        result: "authenticated",
        snapshot,
        account: dependencies.getAccount(snapshot.accountId),
      } as const;
    }
    if (mapping.phase !== "active") return { result: "blocked" } as const;
    const account = dependencies.getAccount(mapping.accountId);
    const snapshot = await account.inspect();
    return { result: "authenticated", snapshot, account } as const;
  } catch {
    return { result: "unavailable" } as const;
  }
}
