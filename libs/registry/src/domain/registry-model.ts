import type { ProjectedGrantState, GrantRegistrySnapshot } from "@cup/conversion-grants";

import { canonicalJson, decodeBase64Url, encodeBase64Url } from "#src/encoding.ts";
import { toIsoString } from "#src/time.ts";

export const REGISTRY_SCHEMA_VERSION = 5;
export const GRANT_LIFETIME_MS = 90 * 24 * 60 * 60 * 1_000;

export type RegistryEntry = {
  requestId: string;
  grantId: string;
  label: string;
  phase: "reserved" | "initialized" | "active";
  createdAtMs: number;
  expiresAtMs: number;
  credentialIssued: boolean;
  grantSnapshot?: GrantRegistrySnapshot;
};

export type RegistryRecord = { grants: RegistryEntry[] };

export function applyGrantRegistrySnapshot(
  entry: RegistryEntry,
  grantSnapshot: GrantRegistrySnapshot,
): "applied" | "replayed" | "stale" {
  if (entry.grantSnapshot !== undefined && grantSnapshot.revision < entry.grantSnapshot.revision) {
    return "stale";
  }
  if (
    entry.grantSnapshot !== undefined &&
    grantSnapshot.revision === entry.grantSnapshot.revision
  ) {
    if (canonicalJson(entry.grantSnapshot) !== canonicalJson(grantSnapshot)) {
      throw new Error("Conflicting Registry snapshot at the same revision");
    }
    return "replayed";
  }
  entry.grantSnapshot = grantSnapshot;
  return "applied";
}

export function deriveProjectedState(entry: RegistryEntry, nowMs: number): ProjectedGrantState {
  if (entry.phase !== "active" || entry.grantSnapshot === undefined) {
    return "provisioning";
  }
  if (entry.grantSnapshot.revokedAtMs !== undefined) {
    return "revoked";
  }
  if (nowMs >= entry.expiresAtMs) {
    return "expired";
  }
  if (entry.grantSnapshot.spentMilliseconds >= entry.grantSnapshot.allowanceMilliseconds) {
    return "exhausted";
  }
  if (
    entry.grantSnapshot.reservedMilliseconds + entry.grantSnapshot.spentMilliseconds >=
    entry.grantSnapshot.allowanceMilliseconds
  ) {
    return "temporarily-full";
  }
  return "open";
}

/**
 * Matches the owner's balance: an overrun can leave reserved and spent duration above the allowance
 * until reservations settle, and the balance then reports no availability.
 */
export function deriveAvailableMilliseconds(usage: {
  allowanceMilliseconds: number;
  reservedMilliseconds: number;
  spentMilliseconds: number;
}): number {
  return Math.max(
    0,
    usage.allowanceMilliseconds - usage.reservedMilliseconds - usage.spentMilliseconds,
  );
}

export function toOperatorFacts(entry: RegistryEntry, nowMs: number) {
  return {
    grantId: entry.grantId,
    requestId: entry.requestId,
    label: entry.label,
    createdAt: toIsoString(entry.createdAtMs),
    expiresAt: toIsoString(entry.expiresAtMs),
    state: deriveProjectedState(entry, nowMs),
  };
}

export function encodeCursor(entry: RegistryEntry): string {
  return encodeKeysetCursor("grantId", entry.createdAtMs, entry.grantId);
}

export function decodeCursor(cursor: string): { createdAtMs: number; grantId: string } {
  const { createdAtMs, id } = decodeKeysetCursor("grantId", cursor);
  return { createdAtMs, grantId: id };
}

export function encodeAccountCursor(account: { createdAtMs: number; accountId: string }): string {
  return encodeKeysetCursor("accountId", account.createdAtMs, account.accountId);
}

export function decodeAccountCursor(cursor: string): { createdAtMs: number; accountId: string } {
  const { createdAtMs, id } = decodeKeysetCursor("accountId", cursor);
  return { createdAtMs, accountId: id };
}

type CursorIdKey = "grantId" | "accountId";

function encodeKeysetCursor(idKey: CursorIdKey, createdAtMs: number, id: string): string {
  return encodeBase64Url(
    new TextEncoder().encode(JSON.stringify({ v: 1, createdAtMs, [idKey]: id })),
  );
}

function decodeKeysetCursor(
  idKey: CursorIdKey,
  cursor: string,
): { createdAtMs: number; id: string } {
  try {
    const decoded = decodeBase64Url(cursor);
    if (encodeBase64Url(decoded) !== cursor) {
      throw new Error();
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(decoded));
    if (!isRecord(value)) {
      throw new Error();
    }
    const id = value[idKey];
    if (
      Object.keys(value).length !== 3 ||
      value["v"] !== 1 ||
      typeof value["createdAtMs"] !== "number" ||
      !Number.isSafeInteger(value["createdAtMs"]) ||
      typeof id !== "string"
    ) {
      throw new Error();
    }
    return { createdAtMs: value["createdAtMs"], id };
  } catch {
    throw new Error("Invalid Registry cursor");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
