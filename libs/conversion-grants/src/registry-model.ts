import { canonicalJson, decodeBase64Url, encodeBase64Url } from "#src/encoding.ts";
import type { ProjectedGrantState } from "#src/grant-contracts.ts";
import type { GrantRegistrySnapshot } from "#src/grant-model.ts";
import { toIsoString } from "#src/time.ts";

export const REGISTRY_SCHEMA_VERSION = 3;
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

export type RegistryRecord = { grants: RegistryEntry[]; conversionGrants: Record<string, string> };

export function applyGrantRegistrySnapshot(
  entry: RegistryEntry,
  grantSnapshot: GrantRegistrySnapshot,
): "applied" | "replayed" | "stale" {
  if (entry.grantSnapshot !== undefined && grantSnapshot.revision < entry.grantSnapshot.revision)
    return "stale";
  if (
    entry.grantSnapshot !== undefined &&
    grantSnapshot.revision === entry.grantSnapshot.revision
  ) {
    if (canonicalJson(entry.grantSnapshot) !== canonicalJson(grantSnapshot))
      throw new Error("Conflicting Registry snapshot at the same revision");
    return "replayed";
  }
  entry.grantSnapshot = grantSnapshot;
  return "applied";
}

export function deriveProjectedState(entry: RegistryEntry, nowMs: number): ProjectedGrantState {
  if (entry.phase !== "active" || entry.grantSnapshot === undefined) return "provisioning";
  if (entry.grantSnapshot.revokedAtMs !== undefined) return "revoked";
  if (nowMs >= entry.expiresAtMs) return "expired";
  if (entry.grantSnapshot.spentMilliseconds >= entry.grantSnapshot.allowanceMilliseconds)
    return "exhausted";
  if (
    entry.grantSnapshot.reservedMilliseconds + entry.grantSnapshot.spentMilliseconds >=
    entry.grantSnapshot.allowanceMilliseconds
  )
    return "temporarily-full";
  return "open";
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
  return encodeBase64Url(
    new TextEncoder().encode(
      JSON.stringify({ v: 1, createdAtMs: entry.createdAtMs, grantId: entry.grantId }),
    ),
  );
}

export function decodeCursor(cursor: string): { createdAtMs: number; grantId: string } {
  try {
    const decoded = decodeBase64Url(cursor);
    if (encodeBase64Url(decoded) !== cursor) throw new Error();
    const value: unknown = JSON.parse(new TextDecoder().decode(decoded));
    if (
      !isRecord(value) ||
      Object.keys(value).length !== 3 ||
      value["v"] !== 1 ||
      typeof value["createdAtMs"] !== "number" ||
      !Number.isSafeInteger(value["createdAtMs"]) ||
      typeof value["grantId"] !== "string"
    )
      throw new Error();
    return { createdAtMs: value["createdAtMs"], grantId: value["grantId"] };
  } catch {
    throw new Error("Invalid Registry cursor");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
