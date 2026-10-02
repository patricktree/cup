import type {
  AudiobookReference,
  ConversionMeasurements,
  ConversionFailureCategory,
  ConversionPhase,
  DurationBalance,
} from "@cup/conversion-contracts";
import {
  calculateDurationBalance,
  type SegmentUsage,
} from "@cup/conversion-contracts/duration-accounting";

import type {
  GrantConversionSnapshot,
  GrantConversions,
  GrantSnapshot,
  GrantState,
  OperatorGrantSnapshot,
} from "#src/grant-contracts.ts";
import { toIsoString } from "#src/time.ts";

export const GRANT_SCHEMA_VERSION = 6;
export const DEFAULT_ALLOWANCE_MILLISECONDS = 120 * 60 * 1_000;
export const RECONCILIATION_CUTOFF_MS = 48 * 60 * 60 * 1_000;

export type PendingConversion = {
  conversionId: string;
  idempotencyKey: string;
  sourceUrl: string;
  acceptedAtMs: number;
  status: "pending";
  lastStartedPhase: ConversionPhase;
  title?: string;
  workflowStartedAtMs?: number;
};
export type ReadyConversion = Omit<PendingConversion, "status"> & {
  status: "ready";
  completedAtMs: number;
  title: string;
  audiobookReference: AudiobookReference;
  measurements?: ConversionMeasurements;
  providerUsage?: Record<string, unknown>;
};
export type FailedConversion = Omit<PendingConversion, "status"> & {
  status: "failed";
  completedAtMs: number;
  title?: string;
  failureCategory: ConversionFailureCategory;
  explanation: string;
  diagnosticReference?: string;
  cleanupState?: "pending" | "complete" | "cleanup_failed";
};
export type GrantConversion = PendingConversion | ReadyConversion | FailedConversion;
export type TerminalOutcome =
  | {
      status: "ready";
      completedAtMs: number;
      title: string;
      audiobookReference: AudiobookReference;
      measurements?: ConversionMeasurements;
      providerUsage?: Record<string, unknown>;
    }
  | {
      status: "failed";
      completedAtMs: number;
      title?: string;
      failureCategory: ConversionFailureCategory;
      explanation: string;
      diagnosticReference?: string;
      cleanupState?: "pending" | "complete" | "cleanup_failed";
    };

export type GrantRecord = {
  allowanceMilliseconds: number;
  grantId: string;
  createdAtMs: number;
  expiresAtMs: number;
  revokedAtMs?: number;
  credentialVerifier?: string;
  credentialIssuedAtMs?: number;
  sessionSigningKey: string;
  signingKeyGeneration: number;
  registrySnapshotRevision: number;
  registryConfirmedSnapshotRevision: number;
  startAttempts: number[];
  conversions: GrantConversion[];
  segmentUsage: SegmentUsage[];
};

export type GrantRegistrySnapshot = {
  allowanceMilliseconds: number;
  grantId: string;
  revision: number;
  revokedAtMs?: number;
  reservedMilliseconds: number;
  spentMilliseconds: number;
  schemaVersion: number;
};

export type StartGrantConversionResult =
  | {
      result: "created" | "replayed";
      conversion: GrantConversion;
      duration: DurationBalance;
      registrySnapshot: GrantRegistrySnapshot;
    }
  | { result: "idempotency-conflict" }
  | { result: "expired" }
  | { result: "revoked" }
  | { result: "temporarily-full" }
  | { result: "exhausted" }
  | { result: "rate-limited"; retryAfterSeconds: number };

export type ExchangeCredentialResult =
  | { result: "created"; sessionToken: string; snapshot: GrantSnapshot }
  | { result: "invalid-credential" }
  | { result: "grant-revoked" };

export type ValidateSessionResult =
  | { result: "valid"; snapshot: GrantSnapshot }
  | { result: "invalid" };

export function toGrantConversionSnapshot(conversion: GrantConversion): GrantConversionSnapshot {
  const base = {
    conversionId: conversion.conversionId,
    sourceUrl: conversion.sourceUrl,
    acceptedAt: toIsoString(conversion.acceptedAtMs),
    ...(conversion.title === undefined ? {} : { title: conversion.title }),
  };
  if (conversion.status === "pending") return { ...base, status: "pending" };
  if (conversion.status === "ready") {
    return {
      ...base,
      status: "ready",
      completedAt: toIsoString(conversion.completedAtMs),
      audiobookUrl: `/app/audiobooks/${conversion.conversionId}`,
    };
  }
  return {
    ...base,
    status: "failed",
    completedAt: toIsoString(conversion.completedAtMs),
    failure: { category: conversion.failureCategory, explanation: conversion.explanation },
  };
}

export function createGrantSnapshot(record: GrantRecord, nowMs: number): GrantSnapshot {
  return {
    grantId: record.grantId,
    createdAt: toIsoString(record.createdAtMs),
    expiresAt: toIsoString(record.expiresAtMs),
    ...(record.revokedAtMs === undefined ? {} : { revokedAt: toIsoString(record.revokedAtMs) }),
    state: deriveGrantState(record, nowMs),
    duration: deriveDurationBalance(record),
  };
}

export function createGrantConversions(record: GrantRecord): GrantConversions {
  return record.conversions
    .toSorted((left, right) => right.acceptedAtMs - left.acceptedAtMs)
    .map(toGrantConversionSnapshot);
}

export function createOperatorGrantSnapshot(
  record: GrantRecord,
  nowMs: number,
): OperatorGrantSnapshot {
  const snapshot = createGrantSnapshot(record, nowMs);
  return {
    ...snapshot,
    allowanceMilliseconds: record.allowanceMilliseconds,
    signingKeyGeneration: record.signingKeyGeneration,
    registrySnapshotRevision: record.registrySnapshotRevision,
    registryConfirmedSnapshotRevision: record.registryConfirmedSnapshotRevision,
    conversions: record.conversions
      .toSorted((left, right) => right.acceptedAtMs - left.acceptedAtMs)
      .map((conversion) => {
        const publicSnapshot = toGrantConversionSnapshot(conversion);
        const reconciliation = {
          state:
            conversion.workflowStartedAtMs !== undefined
              ? ("confirmed" as const)
              : nowMs - conversion.acceptedAtMs >= RECONCILIATION_CUTOFF_MS
                ? ("cutoff-ambiguous" as const)
                : ("unconfirmed" as const),
          ...(conversion.workflowStartedAtMs === undefined
            ? {}
            : { workflowStartedAt: toIsoString(conversion.workflowStartedAtMs) }),
        };
        const facts = {
          ...publicSnapshot,
          idempotencyKey: conversion.idempotencyKey,
          workflowId: conversion.conversionId,
          reconciliation,
        };
        if (conversion.status === "ready")
          return {
            ...facts,
            ...(conversion.measurements === undefined
              ? {}
              : { measurements: conversion.measurements }),
            ...(conversion.providerUsage === undefined
              ? {}
              : { providerUsage: conversion.providerUsage }),
          };
        if (conversion.status === "failed")
          return {
            ...facts,
            ...(conversion.diagnosticReference === undefined
              ? {}
              : { diagnosticReference: conversion.diagnosticReference }),
            ...(conversion.cleanupState === undefined
              ? {}
              : { cleanupState: conversion.cleanupState }),
          };
        return facts;
      }),
  };
}

export function deriveDurationBalance(record: GrantRecord): DurationBalance {
  return calculateDurationBalance(record.allowanceMilliseconds, record.segmentUsage);
}

export function deriveGrantState(record: GrantRecord, nowMs: number): GrantState {
  if (record.revokedAtMs !== undefined) return "revoked";
  if (nowMs >= record.expiresAtMs) return "expired";
  const duration = deriveDurationBalance(record);
  if (duration.spentMilliseconds >= record.allowanceMilliseconds) return "exhausted";
  if (duration.availableMilliseconds === 0) return "temporarily-full";
  return "open";
}

export function createGrantRegistrySnapshot(record: GrantRecord): GrantRegistrySnapshot {
  const duration = deriveDurationBalance(record);
  return {
    grantId: record.grantId,
    revision: record.registrySnapshotRevision,
    allowanceMilliseconds: record.allowanceMilliseconds,
    ...(record.revokedAtMs === undefined ? {} : { revokedAtMs: record.revokedAtMs }),
    reservedMilliseconds: duration.reservedMilliseconds,
    spentMilliseconds: duration.spentMilliseconds,
    schemaVersion: GRANT_SCHEMA_VERSION,
  };
}
