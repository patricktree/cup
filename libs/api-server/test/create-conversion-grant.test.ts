import { expect, test } from "vitest";

import {
  createConversionGrant,
  type CreateConversionGrantDependencies,
} from "#src/use-cases/create-conversion-grant.ts";

test("provisions a grant and returns its root credential", async () => {
  const calls: string[] = [];
  const entry = {
    requestId: "request-id",
    grantId: "grant-id",
    label: "Editorial trial",
    phase: "reserved" as const,
    createdAtMs: 1_000,
    expiresAtMs: 2_000,
    credentialIssued: false,
  };
  const grantSnapshot = {
    grantId: "grant-id",
    revision: 1,
    reservedMilliseconds: 0,
    spentMilliseconds: 0,
    schemaVersion: 2,
    allowanceMilliseconds: 5,
  };
  const dependencies: CreateConversionGrantDependencies = {
    registry: {
      reserveProvisioning: async () => {
        calls.push("reserve");
        return { entry, created: true };
      },
      activate: async (_requestId, activeGrantSnapshot, credentialIssued) => {
        calls.push(`activate:${credentialIssued.toString()}`);
        return {
          ...entry,
          phase: "active",
          credentialIssued,
          grantSnapshot: activeGrantSnapshot,
        };
      },
    },
    getGrant: () => ({
      initialize: async () => {
        calls.push("initialize");
        return grantSnapshot;
      },
      installCredentialVerifier: async (verifier, issuedAtMs) => {
        calls.push(`install:${verifier}:${issuedAtMs.toString()}`);
        return "installed";
      },
    }),
    createRootCredential: async () => {
      calls.push("create-credential");
      return { credential: "root-credential", verifier: "credential-verifier" };
    },
  };

  await expect(
    createConversionGrant(
      { requestId: "request-id", label: "Editorial trial", issuedAtMs: 1_500 },
      dependencies,
    ),
  ).resolves.toEqual({
    result: "issued",
    credential: "root-credential",
    grantId: "grant-id",
    requestId: "request-id",
    label: "Editorial trial",
    createdAtMs: 1_000,
    expiresAtMs: 2_000,
  });
  expect(calls).toEqual([
    "reserve",
    "initialize",
    "activate:false",
    "create-credential",
    "install:credential-verifier:1500",
    "activate:true",
  ]);
});

test("does not issue a second credential for an already provisioned grant", async () => {
  const entry = {
    requestId: "request-id",
    grantId: "grant-id",
    label: "Editorial trial",
    phase: "active" as const,
    createdAtMs: 1_000,
    expiresAtMs: 2_000,
    credentialIssued: true,
  };
  const dependencies: CreateConversionGrantDependencies = {
    registry: {
      reserveProvisioning: async () => ({ entry, created: false }),
      activate: async () => {
        throw new Error("activate must not be called");
      },
    },
    getGrant: () => {
      throw new Error("getGrant must not be called");
    },
    createRootCredential: async () => {
      throw new Error("createRootCredential must not be called");
    },
  };

  await expect(
    createConversionGrant(
      { requestId: "request-id", label: "Editorial trial", issuedAtMs: 1_500 },
      dependencies,
    ),
  ).resolves.toEqual({
    result: "already-issued",
    grantId: "grant-id",
    requestId: "request-id",
    label: "Editorial trial",
    createdAtMs: 1_000,
    expiresAtMs: 2_000,
  });
});
