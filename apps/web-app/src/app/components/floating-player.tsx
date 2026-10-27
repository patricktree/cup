import { css } from "@linaria/core";
import React from "react";

import { ShellFooter } from "#src/app/components/main.tsx";
import { PlaybackError } from "#src/app/components/playback-error.js";
import { DSIconButton } from "#src/app/design-system/icon-button.js";
import { PauseIcon, PlayIcon } from "#src/app/design-system/icons.js";
import type { Player } from "#src/app/player/narration-track-player.js";
import { formatDuration, formatTimelinePosition } from "#src/app/player/playback-format.js";
import {
  usePlayerHost,
  usePlayerHostSnapshot,
  usePlayerState,
} from "#src/app/player/player-host-provider.js";
import type { LoadedAudiobook } from "#src/app/player/player-host.js";

/**
 * Full controls for the loaded audiobook, below its own detail view. Account pages show the mini
 * player instead (see mini-player.tsx), and other detail views neither.
 */
export function FloatingPlayer(): React.ReactNode {
  const { loaded, shown } = usePlayerHostSnapshot();

  // The reader page reports the audiobook it shows to the host.
  if (!loaded || shown?.conversionId !== loaded.conversionId) {
    return null;
  }

  return (
    <ShellFooter
      aria-label="Player"
      className={css`
        /* put above shell <main> and above the fade of the tab bar (account-tab-bar.tsx) below */
        z-index: 2;

        /* one column as wide as the page above, centered */
        display: grid;
        grid-area: shell-floating-player;
        grid-template-columns: minmax(0, var(--app-max-width));
        gap: var(--spacing-base);
        justify-content: center;
        padding-block: calc(1.5 * var(--spacing-base));
        padding-inline: var(--app-padding-inline);

        background-color: var(--color-bg);
        border-top: 1.5px solid var(--color-fg-emphasized-xs);
      `}
    >
      <FullControls loaded={loaded} />
      <PlaybackError player={loaded.player} />
    </ShellFooter>
  );
}

function FullControls({ loaded }: { loaded: LoadedAudiobook }) {
  return (
    <div
      className={css`
        display: grid;
        justify-items: center;

        & > :first-child {
          width: 100%;
        }
      `}
    >
      <PlaybackProgress player={loaded.player} title={loaded.audiobook.title} />
      <PlayPauseButton loaded={loaded} />
    </div>
  );
}

function PlayPauseButton({ loaded }: { loaded: LoadedAudiobook }) {
  const host = usePlayerHost();
  const isPlaying = usePlayerState(loaded.player, (state) => state.isPlaying);

  return (
    <DSIconButton
      label={isPlaying ? "Pause" : "Play"}
      icon={isPlaying ? <PauseIcon /> : <PlayIcon />}
      onClick={() => (isPlaying ? host.pause() : host.play())}
    />
  );
}

/** Position and length on the whole-audiobook timeline, with seeking. */
function PlaybackProgress({ player, title }: { player: Player; title: string }) {
  const { positionMilliseconds, durationMilliseconds } = usePlaybackProgress(player);

  return (
    <div
      className={css`
        display: grid;
        grid-template-rows: max-content max-content;
        align-items: center;

        font-size: var(--font-size-sm);
        font-variant-numeric: tabular-nums;
        color: var(--color-fg-emphasized-sm);
      `}
    >
      <div
        className={css`
          display: flex;
          align-items: center;

          & > input {
            flex: 1;
            min-width: 0;
            accent-color: var(--color-primary);
          }
        `}
      >
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
      </div>

      <div
        className={css`
          display: flex;
          gap: var(--spacing-base);
          align-items: center;
          justify-content: space-between;
        `}
      >
        <span>{formatTimelinePosition(positionMilliseconds)}</span>
        <span>{formatTimelinePosition(durationMilliseconds)}</span>
      </div>
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
