import { check } from "@patricktree-stack/utils-ecma/assert.utils";
import { QueryObserver, useQueryClient } from "@tanstack/react-query";
import React from "react";

import { createPlaybackSession, createPlayer } from "#src/app/player/create-playback.js";
import type { PreparedAudiobook } from "#src/app/player/playback-session.js";
import {
  PlayerHost,
  type LoadedAudiobook,
  type PlayerHostAccount,
  type PlayerHostSnapshot,
} from "#src/app/player/player-host.js";
import { authStateSnapshot, subscribeAuthState } from "#src/auth/account-session.js";
import { createAudiobookQuery, getLocalPlaybackPosition } from "#src/data-fetching/reader.js";
import {
  registerPlayerMediaSession,
  type Player,
  type PlayerSnapshot,
} from "#src/platform/player.js";
import { STOP_PLAYBACK_EVENT_NAME } from "#src/playback-events.js";

const PlayerHostContext = React.createContext<PlayerHost | null>(null);

/**
 * Provides the app's single player to every page below it and feeds it the account and the loaded
 * audiobook's latest version; unmounting it stops playback.
 */
export function PlayerHostProvider({ children }: { children: React.ReactNode }) {
  const [host] = React.useState(
    () =>
      new PlayerHost({
        createSession: createPlaybackSession,
        createPlayer,
        registerMediaSession: registerPlayerMediaSession,
        getAccount: readPlayerHostAccount,
        getLocalPosition: getLocalPlaybackPosition,
      }),
  );
  const loadedConversionId = React.useSyncExternalStore(
    host.subscribe,
    () => host.getSnapshot().loaded?.conversionId,
  );
  const queryClient = useQueryClient();

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

  React.useEffect(
    function reportLatestVersionOfLoadedAudiobook() {
      if (loadedConversionId === undefined) {
        return undefined;
      }

      // Observing the query keeps it polling while a retry synthesizes and the listener is elsewhere.
      const observer = new QueryObserver(queryClient, createAudiobookQuery(loadedConversionId));
      const reportLatestVersion = () => {
        const latest = observer.getCurrentResult().data;
        if (latest) {
          host.updateLoadedAudiobook(loadedConversionId, latest);
        }
      };
      reportLatestVersion();
      return observer.subscribe(reportLatestVersion);
    },
    [host, loadedConversionId, queryClient],
  );

  return <PlayerHostContext value={host}>{children}</PlayerHostContext>;
}

export function usePlayerHost(): PlayerHost {
  const host = React.use(PlayerHostContext);
  check.assert(host, "usePlayerHost must be used below PlayerHostProvider.");
  return host;
}

/** Re-renders when another audiobook is loaded or shown, consent changes, or authorization fails. */
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
  play: () => void;
  /** Must be called from a user gesture. */
  playFromUnit: (unitIndex: number) => void;
  playWithoutFailedSegments: () => void;
};

/**
 * Reports the prepared audiobook a page shows, below `useShownConversion`, and describes its
 * playback. Play and taps load the audiobook first when another one is loaded.
 */
export function useShownAudiobook(
  conversionId: string,
  audiobook: PreparedAudiobook,
): ShownAudiobookPlayback {
  const host = usePlayerHost();
  const { loaded, shown } = usePlayerHostSnapshot();

  React.useLayoutEffect(
    function showLatestVersion() {
      host.showConversion(conversionId, audiobook);
    },
    [host, conversionId, audiobook],
  );

  return {
    loaded: loaded?.conversionId === conversionId ? loaded : null,
    canPlay: shown?.conversionId === conversionId && shown.canPlay,
    // Wrapped so that a click event is not taken for a unit index.
    play: () => host.playShown(),
    playFromUnit: host.playShown,
    playWithoutFailedSegments: host.consentToSkippingSegmentsWithoutAudio,
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
