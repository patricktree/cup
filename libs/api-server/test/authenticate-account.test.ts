import { expect, test, vi } from "vitest";

import type { AccountSnapshot } from "@cup/accounts";

import { authenticateAccount } from "#src/use-cases/authenticate-account.ts";
import type { AuthenticateAccountDependencies } from "#src/use-cases/authenticate-account.ts";

function fixture() {
  const snapshot: AccountSnapshot = {
    accountId: "account",
    subject: "subject",
    createdAtMs: 1,
    state: "active",
    executionEpoch: 0,
    recoveryDeadlineMs: null,
    balance: { unit: "audio-millisecond", available: 1000, reserved: 0 },
  };
  const account = { inspect: vi.fn<() => Promise<AccountSnapshot>>(async () => snapshot) };
  const dependencies = {
    registry: {
      findIdentity: vi.fn<
        AuthenticateAccountDependencies<typeof account>["registry"]["findIdentity"]
      >(async () => undefined),
      provisionFromIngress: vi.fn<
        AuthenticateAccountDependencies<typeof account>["registry"]["provisionFromIngress"]
      >(async () => ({ result: "provisioned", snapshot })),
      provisionVerifiedIdentity: vi.fn<(subject: string) => Promise<AccountSnapshot>>(
        async () => snapshot,
      ),
    },
    getIngressIdentity: vi.fn<() => Promise<string | undefined>>(async () => "ingress"),
    getAccount: vi.fn<(accountId: string) => typeof account>(() => account),
  };
  return { snapshot, account, dependencies };
}

test("first-use identities provision through ingress limits", async () => {
  const { dependencies, snapshot, account } = fixture();
  expect(await authenticateAccount("subject", dependencies)).toEqual({
    result: "authenticated",
    snapshot,
    account,
  });
  expect(dependencies.registry.provisionFromIngress).toHaveBeenCalledWith("subject", "ingress");
  expect(dependencies.getAccount).toHaveBeenCalledWith(snapshot.accountId);
});

test("unfinished provisioning resumes without charging ingress limits again", async () => {
  const { dependencies, snapshot, account } = fixture();
  dependencies.registry.findIdentity.mockResolvedValue({
    accountId: snapshot.accountId,
    phase: "provisioning",
  });
  expect(await authenticateAccount("subject", dependencies)).toEqual({
    result: "authenticated",
    snapshot,
    account,
  });
  expect(dependencies.registry.provisionVerifiedIdentity).toHaveBeenCalledWith("subject");
  expect(dependencies.getIngressIdentity).not.toHaveBeenCalled();
  expect(dependencies.registry.provisionFromIngress).not.toHaveBeenCalled();
});

test("existing accounts retain their lifecycle snapshot for route-specific authorization", async () => {
  const { dependencies, snapshot, account } = fixture();
  snapshot.state = "deletion_scheduled";
  dependencies.registry.findIdentity.mockResolvedValue({
    accountId: snapshot.accountId,
    phase: "active",
  });
  expect(await authenticateAccount("subject", dependencies)).toEqual({
    result: "authenticated",
    snapshot,
    account,
  });
  expect(account.inspect).toHaveBeenCalledOnce();
  expect(dependencies.getIngressIdentity).not.toHaveBeenCalled();
});

test("deleting identity mappings block account access", async () => {
  const { dependencies } = fixture();
  dependencies.registry.findIdentity.mockResolvedValue({
    accountId: "account",
    phase: "deleting_identity",
  });
  expect(await authenticateAccount("subject", dependencies)).toEqual({ result: "blocked" });
  expect(dependencies.getAccount).not.toHaveBeenCalled();
});

test("a missing trusted ingress identity prevents first-use provisioning", async () => {
  const { dependencies } = fixture();
  dependencies.getIngressIdentity.mockResolvedValue(undefined);
  expect(await authenticateAccount("subject", dependencies)).toEqual({ result: "unavailable" });
  expect(dependencies.registry.provisionFromIngress).not.toHaveBeenCalled();
});

test("signup rate limits preserve retry timing", async () => {
  const { dependencies } = fixture();
  dependencies.registry.provisionFromIngress.mockResolvedValue({
    result: "rate-limited",
    retryAfter: 30,
  });
  expect(await authenticateAccount("subject", dependencies)).toEqual({
    result: "rate-limited",
    retryAfter: 30,
  });
  expect(dependencies.getAccount).not.toHaveBeenCalled();
});

test("registry failures remain unavailable", async () => {
  const { dependencies } = fixture();
  dependencies.registry.findIdentity.mockRejectedValue(new Error("Storage unavailable"));
  expect(await authenticateAccount("subject", dependencies)).toEqual({ result: "unavailable" });
});
