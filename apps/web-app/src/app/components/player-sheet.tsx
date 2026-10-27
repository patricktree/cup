import { Slider } from "@base-ui/react/slider";
import { css } from "@linaria/core";
import React from "react";

import { PlaybackError } from "#src/app/components/playback-error.js";
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

/** Height of the drawn fade, from its transparent top to the bottom of the screen. */
const FADE_HEIGHT_PIXELS = 305;
/** The sheet's own row, without a playback error; the rest of the fade reaches over the page. */
const SHEET_HEIGHT_PIXELS = 200;

/**
 * Bottom padding of the page above the sheet, so its last text ends where the fade begins. A
 * playback error makes the sheet taller, which only moves the page further up.
 */
export const PLAYER_SHEET_CLEARANCE = `${FADE_HEIGHT_PIXELS - SHEET_HEIGHT_PIXELS}px`;

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
 * shows the start; Play, seeking and skipping load it, replacing another loaded audiobook.
 */
export function PlayerSheet({ status }: { status: string }): React.JSX.Element {
  const host = usePlayerHost();
  const { loaded, shown } = usePlayerHostSnapshot();
  const audiobook =
    shown?.audiobook && isPlayableAudiobook(shown.audiobook) ? shown.audiobook : null;
  const shownLoaded = loaded && loaded.conversionId === shown?.conversionId ? loaded : null;

  let controls: React.ReactNode;
  if (shownLoaded) {
    controls = <LoadedControls loaded={shownLoaded} />;
  } else if (audiobook) {
    // Shows the start, so −15 s and +15 s skip from there.
    controls = (
      <SheetControls
        playback={{
          status: "enabled",
          title: audiobook.title,
          positionMilliseconds: 0,
          durationMilliseconds: audiobook.narrationTrack.durationMilliseconds,
          isPlaying: false,
          seekTo: (positionMilliseconds) => host.loadShown()?.seekTo(positionMilliseconds),
          skipBy: (deltaMilliseconds) => host.loadShown()?.seekTo(Math.max(0, deltaMilliseconds)),
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
      className={css`
        /* containing block for the fade below */
        position: relative;

        /* above shell <main>, whose end scrolls under the fade */
        z-index: 1;
        display: grid;
        grid-area: shell-player;
        align-content: end;
        min-height: ${SHEET_HEIGHT_PIXELS}px;
        padding-block: 0 24px;
        padding-inline: 24px;

        &::before {
          position: absolute;
          inset-inline: 0;
          bottom: 0;
          z-index: -1;
          height: ${FADE_HEIGHT_PIXELS}px;

          /* let clicks reach the content fading underneath */
          pointer-events: none;
          content: "";
          background: var(--background-fade-player-sheet);
        }
      `}
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
        {shownLoaded ? <PlaybackError player={shownLoaded.player} /> : null}
        <output className={textStyles.h5}>{status}</output>
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
        togglePlayback: () => (isPlaying ? host.pause() : host.play()),
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
              outline: 2px solid var(--color-ink);
              outline-offset: 2px;
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
