import { Slider } from "@base-ui/react/slider";
import { css } from "@linaria/core";
import React from "react";

import {
  fixDuringViewTransition,
  FADE_FOOTER_PADDING_BLOCK_END_PIXELS,
  fadeFooter,
} from "#src/app/components/fade-footer.js";
import { PlaybackError, PlaybackErrorMessage } from "#src/app/components/playback-error.js";
import { DSIconButton } from "#src/app/design-system/icon-button.js";
import {
  PauseIcon,
  PlayIcon,
  SkipBack15Icon,
  SkipForward15Icon,
} from "#src/app/design-system/icons.js";
import { textStyles } from "#src/app/design-system/text-styles.js";
import { interTypefaceScope } from "#src/app/global-styles.js";
import { SKIP_MILLISECONDS } from "#src/app/player/narration-track-player.js";
import { formatDuration, formatTimelinePosition } from "#src/app/player/playback-format.js";
import { isPlayableAudiobook } from "#src/app/player/playback-session.js";
import {
  usePlayerHost,
  usePlayerHostSnapshot,
  usePlayerState,
} from "#src/app/player/player-host-provider.js";
import type { LoadedAudiobook } from "#src/app/player/player-host.js";
import { composeClassnames } from "#src/app/utils.js";

/**
 * The player sheet's fade. The page above leaves `fadeFooterClearance(PLAYER_SHEET_HEIGHTS)` free
 * at its end; the sheet takes its own row below the page, however tall a playback error makes it.
 */
export const PLAYER_SHEET_HEIGHTS = {
  fadeHeightPixels: 70,
} as const;

type SheetPlayback =
  | { status: "disabled"; title: string | undefined }
  | {
      status: "enabled";
      title: string;
      positionMilliseconds: number;
      durationMilliseconds: number;
      isPlaying: boolean;
      seekTo: (positionMilliseconds: number) => void;
      skipBy: (deltaMilliseconds: number) => void;
      togglePlayback: () => void;
    };

/**
 * The detail view's player, fixed at the bottom on the drawn fade: the status line, a scrubber, the
 * elapsed and remaining time, and −15 s / play-pause / +15 s. It controls the shown audiobook and
 * is disabled until that audiobook has a narration track. Before the shown audiobook is loaded it
 * shows the start; Play, seeking and skipping load it, replacing another loaded audiobook, and a
 * skip starts from the listener's stored position.
 */
export function PlayerSheet({ statusLine }: { statusLine: string }): React.JSX.Element {
  const host = usePlayerHost();
  const { loaded, shown, unavailable } = usePlayerHostSnapshot();
  const audiobook =
    shown?.canPlay && shown.audiobook && isPlayableAudiobook(shown.audiobook)
      ? shown.audiobook
      : null;
  const shownLoaded = loaded && loaded.conversionId === shown?.conversionId ? loaded : null;

  let controls: React.ReactNode;
  if (shownLoaded) {
    controls = <LoadedControls loaded={shownLoaded} />;
  } else if (audiobook) {
    // Shows the start, but −15 s and +15 s skip from the position the loaded player resumes from.
    controls = (
      <SheetControls
        playback={{
          status: "enabled",
          title: audiobook.title,
          positionMilliseconds: 0,
          durationMilliseconds: audiobook.narrationTrack.durationMilliseconds,
          isPlaying: false,
          seekTo: (positionMilliseconds) => host.loadShown()?.seekTo(positionMilliseconds),
          skipBy: (deltaMilliseconds) => host.loadShown()?.skipBy(deltaMilliseconds),
          togglePlayback: () => host.playShown(),
        }}
      />
    );
  } else {
    controls = <SheetControls playback={{ status: "disabled", title: shown?.audiobook?.title }} />;
  }

  return (
    <footer
      {...interTypefaceScope}
      aria-label="Player"
      className={composeClassnames(
        fadeFooter,
        fixDuringViewTransition,
        css`
          --fade-height: ${PLAYER_SHEET_HEIGHTS.fadeHeightPixels}px;
          --fade-background: var(--background-fade-player-sheet);

          display: grid;
          grid-area: shell-footer;
          align-content: end;
          padding-block: 0 ${FADE_FOOTER_PADDING_BLOCK_END_PIXELS}px;
          padding-inline: 24px;
          background-color: var(--color-surface);
        `,
      )}
    >
      <div
        className={css`
          display: grid;
          width: 100%;

          /* as wide as the page's text above */
          max-width: calc(var(--app-max-width) - 2 * var(--app-padding-inline));
          margin-inline: auto;
        `}
      >
        {shownLoaded ? (
          <PlaybackError player={shownLoaded.player} />
        ) : unavailable && unavailable.conversionId === shown?.conversionId ? (
          <PlaybackErrorMessage message={unavailable.message} />
        ) : null}
        <output className={textStyles.h5}>{statusLine}</output>
        {controls}
      </div>
    </footer>
  );
}

function LoadedControls({ loaded }: { loaded: LoadedAudiobook }): React.JSX.Element {
  const host = usePlayerHost();
  const { player } = loaded;
  const positionMilliseconds = usePlayerState(player, (state) => state.positionMilliseconds);
  const durationMilliseconds = usePlayerState(player, (state) => state.durationMilliseconds);
  const isPlaying = usePlayerState(player, (state) => state.isPlaying);

  return (
    <SheetControls
      playback={{
        status: "enabled",
        title: loaded.audiobook.title,
        // The position never exceeds the length.
        positionMilliseconds: Math.min(positionMilliseconds, durationMilliseconds),
        durationMilliseconds,
        isPlaying,
        seekTo: player.seekTo,
        skipBy: player.skipBy,
        togglePlayback: host.togglePlayback,
      }}
    />
  );
}

/** Draws the scrubber, times and buttons; disabled, at 24 % ink with unknown times. */
function SheetControls({ playback }: { playback: SheetPlayback }): React.JSX.Element {
  const isDisabled = playback.status === "disabled";
  const positionMilliseconds = isDisabled ? 0 : playback.positionMilliseconds;
  const durationMilliseconds = isDisabled ? 0 : playback.durationMilliseconds;
  const isPlaying = !isDisabled && playback.isPlaying;

  return (
    <>
      <Slider.Root
        value={positionMilliseconds}
        min={0}
        // A disabled scrubber still needs a range to draw its empty track.
        max={isDisabled ? 1 : durationMilliseconds}
        step={1_000}
        disabled={isDisabled}
        onValueChange={(value) => {
          if (!isDisabled) {
            playback.seekTo(value);
          }
        }}
        className={css`
          margin-block-start: 20px;
        `}
      >
        <Slider.Control
          className={css`
            display: flex;
            align-items: center;
            height: 24px;
            touch-action: none;
            cursor: pointer;

            &[data-disabled] {
              cursor: not-allowed;
            }

            /* the thumb is invisible, so the scrubber shows its focus ring */
            &:has(:focus-visible) {
              outline: var(--focus-ring);
              outline-offset: var(--focus-ring-offset);
              border-radius: var(--border-radius-full);
            }
          `}
        >
          <Slider.Track
            className={css`
              position: relative;
              width: 100%;
              height: 8px;
              background-color: var(--color-placeholder);
              border-radius: var(--border-radius-full);
            `}
          >
            <Slider.Indicator
              className={css`
                background-color: var(--color-ink);
                border-radius: var(--border-radius-full);
              `}
            />
            <Slider.Thumb
              getAriaLabel={() => `Position in ${playback.title ?? "track"}`}
              getAriaValueText={() =>
                isDisabled
                  ? "Not available"
                  : `${formatDuration(positionMilliseconds)} of ${formatDuration(durationMilliseconds)}`
              }
              className={css`
                width: 1px;
                height: 8px;
                outline: none;
              `}
            />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>

      <div
        className={composeClassnames(
          textStyles.label,
          css`
            display: flex;
            justify-content: space-between;
            padding-block: 6px;
            font-weight: 400;
            font-variant-numeric: tabular-nums;
            color: var(--color-ink-60);
          `,
        )}
      >
        <span>{isDisabled ? "-:--" : formatTimelinePosition(positionMilliseconds)}</span>
        <span>
          {isDisabled
            ? "-:--"
            : `-${formatTimelinePosition(durationMilliseconds - positionMilliseconds)}`}
        </span>
      </div>

      <div
        className={css`
          display: flex;
          gap: 64px;
          align-items: center;
          justify-content: center;
          margin-block-start: 4px;
        `}
      >
        <DSIconButton
          label="Back 15 seconds"
          icon={<SkipBack15Icon />}
          disabled={isDisabled}
          onClick={() => !isDisabled && playback.skipBy(-SKIP_MILLISECONDS)}
        />
        <DSIconButton
          label={isPlaying ? "Pause" : "Play"}
          icon={isPlaying ? <PauseIcon /> : <PlayIcon />}
          disabled={isDisabled}
          onClick={() => !isDisabled && playback.togglePlayback()}
        />
        <DSIconButton
          label="Forward 15 seconds"
          icon={<SkipForward15Icon />}
          disabled={isDisabled}
          onClick={() => !isDisabled && playback.skipBy(SKIP_MILLISECONDS)}
        />
      </div>
    </>
  );
}
