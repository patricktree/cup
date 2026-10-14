import { check } from "@patricktree-stack/utils-ecma/assert.utils";
import { QueryObserver, useQueryClient } from "@tanstack/react-query";
import React from "react";

import type { PlayerSnapshot } from "#src/app/player/audiobook-player.js";
import {
  PlayerHost,
  type LoadedAudiobook,
  type PlayerHostSnapshot,
} from "#src/app/player/player-host.js";
import { refreshPlaybackAuthorization } from "#src/auth/account-session.js";
import { useAccountAuthState } from "#src/auth/hooks.js";
import { createAudiobookQuery } from "#src/data-fetching/trial-link.js";
import { createPlayer, registerPlayerMediaSession, type Player } from "#src/platform/player.js";
import { STOP_PLAYBACK_EVENT_NAME } from "#src/playback-events.js";

const PlayerHostContext = React.createContext<PlayerHost | null>(null);

/** Provides the app's single player to every page below it; unmounting it stops playback. */
export function PlayerHostProvider({ children }: { children: React.ReactNode }) {
  const [host] = React.useState(
    () =>
      new PlayerHost({
        createPlayer,
        registerMediaSession: registerPlayerMediaSession,
        authorize: () => refreshPlaybackAuthorization(),
      }),
  );
  const { loaded } = React.useSyncExternalStore(host.subscribe, host.getSnapshot);
  const authState = useAccountAuthState();
  const isRestoringAccount = authState.status === "loading";
  const subject = authState.status === "signed-in" ? authState.session.user.id : null;
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
    function unloadForAnotherUser() {
      // Media authorization and the listening position belong to the user the audiobook was loaded for.
      if (loaded && !isRestoringAccount && loaded.subject !== subject) host.unload();
    },
    [host, loaded, isRestoringAccount, subject],
  );

  React.useEffect(
    function swapInNewAudioWhilePaused() {
      if (!loaded) return undefined;

      // Observing the query keeps it polling while a retry synthesizes and the listener is elsewhere.
      const observer = new QueryObserver(queryClient, createAudiobookQuery(loaded.conversionId));
      const swapWhenNewAudioIsPlayable = () => {
        const latest = observer.getCurrentResult().data;
        if (
          host.getSnapshot().loaded !== loaded ||
          loaded.player.getSnapshot().isPlaying ||
          latest?.status !== "ready" ||
          countReadySegments(latest.segments) <= countReadySegments(loaded.audiobook.segments)
        )
          return;

        host.replaceAudiobook(latest);
      };
      const unsubscribeFromQuery = observer.subscribe(swapWhenNewAudioIsPlayable);
      // A swap waits for playback to pause; a new player could start only from a user gesture.
      const unsubscribeFromPlayer = loaded.player.subscribe(swapWhenNewAudioIsPlayable);
      return () => {
        unsubscribeFromQuery();
        unsubscribeFromPlayer();
      };
    },
    [host, loaded, queryClient],
  );

  return <PlayerHostContext value={host}>{children}</PlayerHostContext>;
}

export function usePlayerHost(): PlayerHost {
  const host = React.use(PlayerHostContext);
  check.assert(host, "usePlayerHost must be used below PlayerHostProvider.");
  return host;
}

/** Re-renders when another audiobook is loaded, its consent changes, or authorization fails. */
export function usePlayerHostSnapshot(): PlayerHostSnapshot {
  const host = usePlayerHost();
  return React.useSyncExternalStore(host.subscribe, host.getSnapshot);
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

function countReadySegments(segments: LoadedAudiobook["audiobook"]["segments"]) {
  return segments.filter((segment) => segment.status === "ready").length;
}
