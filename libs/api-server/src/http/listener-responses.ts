import type {
  AccountConversionOutcome,
  AccountHistoryPage,
  AccountSnapshot as StoredAccountSnapshot,
} from "@cup/accounts/contracts";
import type { AccountLifecycle } from "@cup/accounts/lifecycle";
import type { Audiobook as StoredAudiobook } from "@cup/audiobook-production";
import {
  layOutConsecutively,
  type DurationBalance,
  type PlaybackPosition,
} from "@cup/conversion-contracts";
import type { GrantSnapshot as StoredGrantSnapshot } from "@cup/conversion-grants/contracts";
import type {
  AccountHistory,
  AccountSnapshot,
  Audiobook,
  DeletionChallenge,
  GrantSnapshot,
  HistoryItem,
} from "@cup/listener-api.routes";

type ReadyAudiobook = Extract<Audiobook, { status: "ready" }>;

/*
 * Listener handlers send Durable Object results through these mappings, which copy only the fields
 * the listener contract declares. `satisfies` rejects missing or mismatched fields but not extra
 * ones in nested values, so copying field by field is what keeps internal fields, such as an
 * outcome's storage reference, out of listener responses. Route tests parse responses strictly.
 */

export function toAccountSnapshotResponse(snapshot: StoredAccountSnapshot) {
  return {
    accountId: snapshot.accountId,
    subject: snapshot.subject,
    createdAtMs: snapshot.createdAtMs,
    state: snapshot.state,
    executionEpoch: snapshot.executionEpoch,
    recoveryDeadlineMs: snapshot.recoveryDeadlineMs,
    balance: {
      unit: snapshot.balance.unit,
      available: snapshot.balance.available,
      reserved: snapshot.balance.reserved,
    },
  } satisfies AccountSnapshot;
}

export function toDeletionChallengeResponse(challenge: ReturnType<AccountLifecycle["challenge"]>) {
  return {
    challengeId: challenge.challengeId,
    subject: challenge.subject,
    issuedAtMs: challenge.issuedAtMs,
    expiresAtMs: challenge.expiresAtMs,
  } satisfies DeletionChallenge;
}

export function toAccountHistoryResponse(page: AccountHistoryPage) {
  return {
    items: page.items.map((item): HistoryItem => ({
      conversionId: item.conversionId,
      idempotencyKey: item.idempotencyKey,
      sourceUrl: item.sourceUrl,
      createdAtMs: item.createdAtMs,
      status: item.status,
      outcome: toHistoryOutcome(item.outcome),
    })),
    nextCursor: page.nextCursor,
  } satisfies AccountHistory;
}

function toHistoryOutcome(outcome: AccountConversionOutcome | null): HistoryItem["outcome"] {
  if (outcome === null) {
    return null;
  }
  if (outcome.status === "ready") {
    return {
      status: "ready",
      title: outcome.title,
      ...(outcome.hasCoverImage === undefined ? {} : { hasCoverImage: outcome.hasCoverImage }),
    };
  }
  return { status: "failed", explanation: outcome.explanation };
}

export function toGrantSnapshotResponse(snapshot: StoredGrantSnapshot) {
  return {
    grantId: snapshot.grantId,
    createdAt: snapshot.createdAt,
    expiresAt: snapshot.expiresAt,
    ...(snapshot.revokedAt === undefined ? {} : { revokedAt: snapshot.revokedAt }),
    state: snapshot.state,
    duration: toDurationBalanceResponse(snapshot.duration),
  } satisfies GrantSnapshot;
}

export function toDurationBalanceResponse(duration: DurationBalance) {
  return {
    availableMilliseconds: duration.availableMilliseconds,
    reservedMilliseconds: duration.reservedMilliseconds,
    spentMilliseconds: duration.spentMilliseconds,
  } satisfies GrantSnapshot["duration"];
}

export function toPlaybackPositionResponse(position: PlaybackPosition | null) {
  return position === null
    ? null
    : ({
        synchronizationUnitId: position.synchronizationUnitId,
        offsetMilliseconds: position.offsetMilliseconds,
      } satisfies ReadyAudiobook["playbackPosition"]);
}

export function toNarrationDocumentResponse(document: StoredAudiobook["narrationDocument"]) {
  return {
    html: document.html,
    synchronizationUnits: document.synchronizationUnits.map((unit) => ({
      id: unit.id,
      narrationText: unit.narrationText,
    })),
  } satisfies ReadyAudiobook["narrationDocument"];
}

/**
 * `durations` are the settled segment durations in sequence order. Each segment starts at the sum
 * of the durations before it; the constant decoder delay at each join is not corrected for.
 */
export function toNarrationTrackResponse(url: string, durations: readonly number[]) {
  const { startOffsets, totalLength } = layOutConsecutively(durations);
  return {
    url,
    durationMilliseconds: totalLength,
    startMilliseconds: startOffsets,
  } satisfies NonNullable<ReadyAudiobook["narrationTrack"]>;
}
