/*
 * A holding ACCOUNTS double. It wraps the real namespace and holds the next call of a chosen account
 * method until the test releases it. While the deletion coordinator awaits an account RPC, its
 * Durable Object's input gate is open, so another call, such as a restore delivery, can land on the
 * coordinator in between; the hold makes that interleaving happen the same way every time.
 * Production code knows nothing about it: the test passes the wrapped namespace as `ACCOUNTS`.
 */

import type { DeletionAccounts } from "#src/account-deletion/deletion-coordinator.ts";

export type AccountMethod = "fenceDeletion" | "eraseAccount";

/** A held call, waiting for the test. */
export type Hold = {
  /** Resolves once the matching call has arrived and is being held. */
  reached: Promise<void>;
  /** Lets the held call run on the real account. */
  release(): void;
};

type PendingHold = { method: AccountMethod; arrive(): Promise<void> };

export type HoldingAccounts = {
  accounts: DeletionAccounts;
  /** Holds the next call of `method`; every other call passes straight through. */
  holdNext(method: AccountMethod): Hold;
};

export function createHoldingAccounts(realAccounts: DeletionAccounts): HoldingAccounts {
  const pendingHolds: PendingHold[] = [];

  async function pass(method: AccountMethod): Promise<void> {
    const holdIndex = pendingHolds.findIndex((hold) => hold.method === method);
    if (holdIndex === -1) {
      return;
    }
    const [hold] = pendingHolds.splice(holdIndex, 1);
    await hold?.arrive();
  }

  return {
    accounts: {
      idFromName: (name) => realAccounts.idFromName(name),
      get: (id) => {
        const account = realAccounts.get(id);
        return {
          fenceDeletion: async (attemptId) => {
            await pass("fenceDeletion");
            return account.fenceDeletion(attemptId);
          },
          eraseAccount: async (attemptId) => {
            await pass("eraseAccount");
            return account.eraseAccount(attemptId);
          },
        };
      },
    },
    holdNext(method) {
      const { promise: reached, resolve: resolveReached } = Promise.withResolvers<void>();
      const { promise: released, resolve: release } = Promise.withResolvers<void>();
      pendingHolds.push({
        method,
        arrive: () => {
          resolveReached();
          return released;
        },
      });
      return { reached, release };
    },
  };
}
