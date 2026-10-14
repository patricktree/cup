import { css } from "@linaria/core";
import { Link, useMatch } from "@tanstack/react-router";
import { Pause, Play } from "lucide-react";
import React from "react";

import { DSButton } from "#src/app/design-system/button.js";
import { formatDuration, formatTimelinePosition } from "#src/app/player/playback-format.js";
import {
  usePlayerHost,
  usePlayerHostSnapshot,
  usePlayerState,
} from "#src/app/player/player-host-provider.js";
import type { LoadedAudiobook } from "#src/app/player/player-host.js";
import type { Player } from "#src/platform/player.js";

/**
 * Controls for the loaded audiobook, shown below every shell page. On the loaded audiobook's own
 * page they expand to its full controls; elsewhere they stay compact.
 */
export function FloatingPlayer(): React.ReactNode {
  const { loaded, authorizationError } = usePlayerHostSnapshot();
  const readerMatch = useMatch({ from: "/_shell/audiobooks/$conversionId", shouldThrow: false });
  if (!loaded) return null;

  const isOnLoadedAudiobookPage = readerMatch?.params.conversionId === loaded.conversionId;

  return (
    <footer
      aria-label="Player"
      className={css`
        /* one column as wide as the page above, centered */
        display: grid;
        grid-template-columns: minmax(0, var(--app-max-width));
        gap: var(--spacing-base);
        justify-content: center;
        padding-block: calc(1.5 * var(--spacing-base));
        padding-inline: var(--app-padding-inline);

        background-color: var(--color-bg);
        border-top: 1.5px solid var(--color-fg-emphasized-xs);
      `}
    >
      {isOnLoadedAudiobookPage ? (
        <FullControls loaded={loaded} />
      ) : (
        <CompactControls loaded={loaded} />
      )}
      <PlaybackError player={loaded.player} authorizationError={authorizationError} />
    </footer>
  );
}

function FullControls({ loaded }: { loaded: LoadedAudiobook }) {
  return (
    <div
      className={css`
        display: grid;
        gap: calc(2 * var(--spacing-base));
        justify-items: center;

        & > :first-child {
          width: 100%;
        }
      `}
    >
      <PlaybackProgress player={loaded.player} title={loaded.audiobook.title} />
      <PlayPauseButton loaded={loaded} iconSize={48} />
    </div>
  );
}

function CompactControls({ loaded }: { loaded: LoadedAudiobook }) {
  return (
    <div
      className={css`
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: var(--spacing-base);
        align-items: center;

        a {
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: var(--font-size-sm);
          font-weight: var(--font-weight-inter-figma-medium);
          color: inherit;
          white-space: nowrap;
        }

        progress {
          grid-column: 1 / -1;
          width: 100%;
          height: 3px;
          accent-color: var(--color-primary);
        }
      `}
    >
      <Link to="/audiobooks/$conversionId" params={{ conversionId: loaded.conversionId }}>
        {loaded.audiobook.title}
      </Link>
      <PlayPauseButton loaded={loaded} iconSize={32} />
      <CompactProgress player={loaded.player} title={loaded.audiobook.title} />
    </div>
  );
}

/** Kept apart so that position updates re-render only the bar, not the title and buttons. */
function CompactProgress({ player, title }: { player: Player; title: string }) {
  const { positionMilliseconds, durationMilliseconds } = usePlaybackProgress(player);

  return (
    <progress
      aria-label={`Position in ${title}`}
      max={durationMilliseconds}
      value={positionMilliseconds}
    />
  );
}

function PlayPauseButton({ loaded, iconSize }: { loaded: LoadedAudiobook; iconSize: number }) {
  const host = usePlayerHost();
  const isPlaying = usePlayerState(loaded.player, (state) => state.isPlaying);

  return (
    <DSButton
      variant="text"
      aria-label={isPlaying ? "Pause" : "Play"}
      // Without consent to skip segments without audio, Play waits for "Play without them" on the page.
      disabled={!isPlaying && !loaded.hasPlaybackConsent}
      onClick={() => (isPlaying ? host.pause() : host.play())}
    >
      {isPlaying ? <Pause size={iconSize} /> : <Play size={iconSize} />}
    </DSButton>
  );
}

/** Position and length on the whole-audiobook timeline, with seeking. */
function PlaybackProgress({ player, title }: { player: Player; title: string }) {
  const { positionMilliseconds, durationMilliseconds } = usePlaybackProgress(player);

  return (
    <div
      className={css`
        display: flex;
        gap: var(--spacing-base);
        align-items: center;

        font-size: var(--font-size-sm);
        font-variant-numeric: tabular-nums;
        color: var(--color-fg-emphasized-sm);

        input {
          flex: 1;
          min-width: 0;
          accent-color: var(--color-primary);
        }
      `}
    >
      <span>{formatTimelinePosition(positionMilliseconds)}</span>
      <input
        type="range"
        aria-label={`Position in ${title}`}
        aria-valuetext={`${formatDuration(positionMilliseconds)} of ${formatDuration(durationMilliseconds)}`}
        min={0}
        max={durationMilliseconds}
        step={1_000}
        value={positionMilliseconds}
        onChange={(event) => player.seekTo(event.currentTarget.valueAsNumber)}
      />
      <span>{formatTimelinePosition(durationMilliseconds)}</span>
    </div>
  );
}

/** Position and length on the whole-audiobook timeline; the position never exceeds the length. */
function usePlaybackProgress(player: Player) {
  const positionMilliseconds = usePlayerState(player, (state) => state.positionMilliseconds);
  const durationMilliseconds = usePlayerState(player, (state) => state.durationMilliseconds);

  return {
    positionMilliseconds: Math.min(positionMilliseconds, durationMilliseconds),
    durationMilliseconds,
  };
}

function PlaybackError({
  player,
  authorizationError,
}: {
  player: Player;
  authorizationError: string | null;
}) {
  const error = usePlayerState(player, (state) => state.error);
  const message = error ?? authorizationError;
  if (!message) return null;

  return (
    /* TODO: implement some general error handling like toasts/snackbars and put it there */
    <p
      role="alert"
      className={css`
        font-size: var(--font-size-sm);
        color: var(--color-error);
      `}
    >
      {message}
    </p>
  );
}
