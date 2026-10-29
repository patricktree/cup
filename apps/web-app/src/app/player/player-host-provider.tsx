import { check } from "@patricktree-stack/utils-ecma/assert.utils";
import { useQueryClient } from "@tanstack/react-query";
import React from "react";

import {
  createNarrationAudioElement,
  createPlaybackSession,
} from "#src/app/player/create-playback.js";
import type { Player, PlayerSnapshot } from "#src/app/player/narration-track-player.js";
import type { PreparedAudiobook } from "#src/app/player/playback-session.js";
import {
  PlayerHost,
  type LoadedAudiobook,
  type PlayerHostAccount,
  type PlayerHostSnapshot,
} from "#src/app/player/player-host.js";
import { authStateSnapshot, subscribeAuthState } from "#src/auth/account-session.js";
import { fetchAudiobookForPlayer, getLocalPlaybackPosition } from "#src/data-fetching/reader.js";
import { publishMediaMetadata } from "#src/platform/media-session.js";
import { STOP_PLAYBACK_EVENT_NAME } from "#src/playback-events.js";

const PlayerHostContext = React.createContext<PlayerHost | null>(null);

/**
 * Provides the app's single player to every page below it and feeds it the account; unmounting it
 * stops playback.
 */
export function PlayerHostProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [host] = React.useState(
    () =>
      new PlayerHost({
        createAudioElement: createNarrationAudioElement,
        createSession: createPlaybackSession,
        publishMediaMetadata,
        getAccount: readPlayerHostAccount,
        getLocalPosition: getLocalPlaybackPosition,
        fetchAudiobook: (conversionId) => fetchAudiobookForPlayer(queryClient, conversionId),
        now: () => Date.now(),
      }),
  );

  React.useEffect(
    function unloadWhenLeavingTheShell() {
      return () => host.unload();
    },
    [host],
  );

  React.useEffect(
    function pauseOnSessionStop() {
      window.addEventListener(STOP_PLAYBACK_EVENT_NAME, host.pause);
      return () => window.removeEventListener(STOP_PLAYBACK_EVENT_NAME, host.pause);
    },
    [host],
  );

  React.useEffect(
    function reportAccountChanges() {
      host.accountChanged();
      // Deferred, because the auth store can publish while a page renders.
      return subscribeAuthState(() => queueMicrotask(host.accountChanged));
    },
    [host],
  );

  return <PlayerHostContext value={host}>{children}</PlayerHostContext>;
}

export function usePlayerHost(): PlayerHost {
  const host = React.use(PlayerHostContext);
  check.assert(host, "usePlayerHost must be used below PlayerHostProvider.");
  return host;
}

/** Re-renders when another audiobook is loaded or shown, or the shown one changes. */
export function usePlayerHostSnapshot(): PlayerHostSnapshot {
  const host = usePlayerHost();
  return React.useSyncExternalStore(host.subscribe, host.getSnapshot);
}

/** Reports that the listener is on this conversion's page, whether or not its audiobook is prepared. */
export function useShownConversion(conversionId: string): void {
  const host = usePlayerHost();

  // Layout effects report the page before the first paint, so its controls never flash.
  React.useLayoutEffect(
    function showWhileOnThePage() {
      host.showConversion(conversionId);
      return () => host.hideConversion(conversionId);
    },
    [host, conversionId],
  );
}

type ShownAudiobookPlayback = {
  /** This page's audiobook, while it is the loaded one. */
  loaded: LoadedAudiobook | null;
  canPlay: boolean;
  /** Must be called from a user gesture. */
  playFromUnit: (unitIndex: number) => void;
};

/**
 * Reports the prepared audiobook a page shows, below `useShownConversion`, and describes its
 * playback. Segment taps load the audiobook first when another one is loaded. `receivedAt` is when
 * the audiobook's response arrived, the query's `dataUpdatedAt`, which dates its track URL.
 */
export function useShownAudiobook(
  conversionId: string,
  audiobook: PreparedAudiobook,
  receivedAt: number,
): ShownAudiobookPlayback {
  const host = usePlayerHost();
  const { loaded, shown } = usePlayerHostSnapshot();

  React.useLayoutEffect(
    function showLatestVersion() {
      host.showConversion(conversionId, audiobook, receivedAt);
    },
    [host, conversionId, audiobook, receivedAt],
  );

  return {
    loaded: loaded?.conversionId === conversionId ? loaded : null,
    canPlay: shown?.conversionId === conversionId && shown.canPlay,
    playFromUnit: host.playShown,
  };
}

/**
 * Reads one value of a player's state and re-renders only when that value changes, not on every
 * position update. Snapshots are compared with `Object.is`, so `select` must return a primitive or
 * an otherwise stable value.
 */
export function usePlayerState<Selected>(
  player: Player,
  select: (snapshot: PlayerSnapshot) => Selected,
): Selected {
  return React.useSyncExternalStore(player.subscribe, () => select(player.getSnapshot()));
}

function readPlayerHostAccount(): PlayerHostAccount {
  const authState = authStateSnapshot();
  if (authState.status === "loading") {
    return { status: "restoring" };
  }

  return {
    status: "known",
    subject: authState.status === "signed-in" ? authState.session.user.id : null,
  };
}
