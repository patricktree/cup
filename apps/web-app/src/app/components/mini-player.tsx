import { css } from "@linaria/core";
import { Link } from "@tanstack/react-router";
import React from "react";

import { TAB_BAR_ICONS_OFFSET_PIXELS } from "#src/app/components/account-tab-bar.js";
import { PlaybackError } from "#src/app/components/playback-error.js";
import { DSCoverImage } from "#src/app/design-system/cover-image.js";
import { DSIconButton } from "#src/app/design-system/icon-button.js";
import { PauseMiniIcon, PlayIcon, SkipBack15Icon } from "#src/app/design-system/icons.js";
import { pressableOverlay } from "#src/app/design-system/interaction-states.js";
import { singleLine, textStyles } from "#src/app/design-system/text-styles.js";
import { interTypefaceScope } from "#src/app/global-styles.js";
import { SKIP_MILLISECONDS } from "#src/app/player/narration-track-player.js";
import {
  usePlayerHost,
  usePlayerHostSnapshot,
  usePlayerState,
} from "#src/app/player/player-host-provider.js";
import type { LoadedAudiobook } from "#src/app/player/player-host.js";
import { toSourceHost } from "#src/app/source-host.js";
import { composeClassnames } from "#src/app/utils.js";

/** The mini player's play icon; only its pause icon is drawn, at this size. */
const PLAY_ICON_SIZE = 32;
/** The drawn gap between the pill and the tab icons below it. */
const GAP_ABOVE_TAB_ICONS_PIXELS = 18;

/**
 * A floating pill above the tab bar of the account pages that controls the loaded audiobook: −15 s
 * and play/pause. Pressing it anywhere else opens the audiobook's detail view. Shows nothing while
 * no audiobook is loaded.
 */
export function MiniPlayer(): React.ReactNode {
  const { loaded } = usePlayerHostSnapshot();
  if (!loaded) {
    return null;
  }

  const { audiobook, player } = loaded;

  return (
    <section
      {...interTypefaceScope}
      aria-label="Player"
      className={css`
        /* above shell <main> and the tab bar's fade (see account-tab-bar.tsx), which it overlaps */
        z-index: 2;
        display: grid;
        grid-area: shell-player;
        gap: 8px;
        width: 100%;
        max-width: var(--app-max-width);
        padding-inline: 10px;

        /* the pill reaches into the tab bar's top padding, ending the drawn gap above its icons */
        margin-block-end: ${GAP_ABOVE_TAB_ICONS_PIXELS - TAB_BAR_ICONS_OFFSET_PIXELS}px;
        margin-inline: auto;
      `}
    >
      <PlaybackError player={player} />
      <div
        className={css`
          /* containing block for the link's pressable area below, which spans the whole pill */
          position: relative;
          display: grid;
          grid-template-columns: 41px minmax(0, 1fr) auto auto;
          gap: 8px;
          align-items: center;
          height: 56px;
          padding-block: 8px;
          padding-inline: 8px 18px;

          background-color: var(--color-surface);
          border: 1px solid var(--color-ink-4);
          border-radius: var(--border-radius-full);
          box-shadow: var(--shadow-card);

          /* the link is the pill's focus target, so the pill shows its focus ring */
          &:has(> a:focus-visible) {
            outline: var(--focus-ring);
            outline-offset: var(--focus-ring-offset);
          }

          /* 6 px between the 44 px hit areas draws the icons 16 px apart */
          & > button + button {
            margin-inline-start: -2px;
          }
        `}
      >
        <DSCoverImage
          src={audiobook.coverImage?.url}
          alt=""
          shape="circle"
          className={css`
            width: 41px;
          `}
        />
        <Link
          to="/audiobooks/$conversionId"
          params={{ conversionId: loaded.conversionId }}
          className={composeClassnames(
            pressableOverlay,
            css`
              /* the pill is the containing block, so the overlay and the area below span it */
              position: static;
              display: grid;
              min-width: 0;

              color: var(--color-ink);
              text-decoration: none;
              border-radius: inherit;

              &:focus-visible {
                outline: none;
              }

              /* pressing the pill outside the buttons opens the detail view */
              &::before {
                position: absolute;
                inset: 0;
                content: "";
              }
            `,
          )}
        >
          <span className={composeClassnames(textStyles.h5, singleLine)}>{audiobook.title}</span>
          <span
            className={composeClassnames(
              textStyles.label,
              singleLine,
              css`
                color: var(--color-ink-40);
              `,
            )}
          >
            {toSourceHost(audiobook.originalUrl)}
          </span>
        </Link>
        <DSIconButton
          label="Back 15 seconds"
          icon={<SkipBack15Icon />}
          className={controlAbovePill}
          onClick={() => player.skipBy(-SKIP_MILLISECONDS)}
        />
        <PlayPauseButton loaded={loaded} />
      </div>
    </section>
  );
}

function PlayPauseButton({ loaded }: { loaded: LoadedAudiobook }): React.JSX.Element {
  const host = usePlayerHost();
  const isPlaying = usePlayerState(loaded.player, (state) => state.isPlaying);

  return (
    <DSIconButton
      label={isPlaying ? "Pause" : "Play"}
      icon={
        isPlaying ? <PauseMiniIcon /> : <PlayIcon width={PLAY_ICON_SIZE} height={PLAY_ICON_SIZE} />
      }
      className={controlAbovePill}
      onClick={host.togglePlayback}
    />
  );
}

/** Lifts a button above the link's pressable area, which spans the pill. */
const controlAbovePill = css`
  z-index: 1;
`;
