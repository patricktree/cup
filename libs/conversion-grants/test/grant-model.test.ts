import { describe, expect, test } from "vitest";

import { ConversionPhase } from "#src/grant-contracts.ts";
import { createGrantConversions, createGrantSnapshot, type GrantRecord } from "#src/grant-model.ts";
import { createGrantSessionCookie, createRootCredential } from "#src/grant-session.ts";

const CREATED_AT_MS = 1_767_225_600_000;
const EXPIRES_AT_MS = 1_775_001_600_000;

describe("conversion grant state", () => {
  test("derives pending reservations, ready spend, and failed release", () => {
    const record = createRecord();
    record.conversions = [
      {
        conversionId: "2f94d6a9-68eb-49eb-b88e-753cf5fba041",
        idempotencyKey: "ff65f13b-5425-4fe5-a29b-21d24087b06e",
        sourceUrl: "https://example.com/pending",
        acceptedAtMs: CREATED_AT_MS,
        status: "pending",
        lastStartedPhase: ConversionPhase.CONVERSION_START,
      },
      {
        conversionId: "09f35cd2-5609-4710-b49c-5c4fe08ef827",
        idempotencyKey: "e6b22802-5f40-4fea-89ca-90ae48e61926",
        sourceUrl: "https://example.com/ready",
        acceptedAtMs: CREATED_AT_MS + 1,
        completedAtMs: CREATED_AT_MS + 2,
        status: "ready",
        lastStartedPhase: ConversionPhase.FINALIZATION,
        title: "Ready",
        audiobookReference: {
          key: "conversions/ready/audiobook.json",
          contentType: "application/json",
          byteLength: 1,
          etag: "etag",
        },
      },
      {
        conversionId: "b3084710-673c-43be-a3cb-98258be258cf",
        idempotencyKey: "00cdd743-4504-4f25-84f0-40dc2557e07a",
        sourceUrl: "https://example.com/failed",
        acceptedAtMs: CREATED_AT_MS + 3,
        completedAtMs: CREATED_AT_MS + 4,
        status: "failed",
        lastStartedPhase: ConversionPhase.FINALIZATION,
        failureCategory: "internal",
        explanation: "The conversion could not be completed.",
      },
    ];

    const snapshot = createGrantSnapshot(record, CREATED_AT_MS + 5);

    expect(snapshot.duration).toEqual({
      availableMilliseconds: 5,
      reservedMilliseconds: 0,
      spentMilliseconds: 0,
    });
    expect(createGrantConversions(record).map((conversion) => conversion.status)).toEqual([
      "failed",
      "ready",
      "pending",
    ]);
  });

  test("uses revocation before expiry and capacity in state precedence", () => {
    const record = createRecord();
    record.revokedAtMs = CREATED_AT_MS + 1;

    expect(createGrantSnapshot(record, EXPIRES_AT_MS + 1).state).toBe("revoked");
  });

  test("blocks at the exact expiry boundary", () => {
    const record = createRecord();

    expect(createGrantSnapshot(record, EXPIRES_AT_MS - 1).state).toBe("open");
    expect(createGrantSnapshot(record, EXPIRES_AT_MS).state).toBe("expired");
  });
});

test("creates a non-recoverable credential shape and path-scoped session cookie", async () => {
  const { credential, verifier } = await createRootCredential();

  expect(credential).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/);
  expect(verifier).not.toContain(credential);
  expect(createGrantSessionCookie("b4ad28a8-bbd7-46af-a17c-59527becd745", "token")).toBe(
    "__Secure-grant-session-b4ad28a8-bbd7-46af-a17c-59527becd745=token; Path=/api; Secure; HttpOnly; SameSite=Lax; Max-Age=34560000",
  );
});

function createRecord(): GrantRecord {
  return {
    allowanceMilliseconds: 5,
    grantId: "b4ad28a8-bbd7-46af-a17c-59527becd745",
    createdAtMs: CREATED_AT_MS,
    expiresAtMs: EXPIRES_AT_MS,
    sessionSigningKey: "key",
    signingKeyGeneration: 1,
    registrySnapshotRevision: 1,
    registryConfirmedSnapshotRevision: 0,
    startAttempts: [],
    conversions: [],
    segmentUsage: [],
  };
}
