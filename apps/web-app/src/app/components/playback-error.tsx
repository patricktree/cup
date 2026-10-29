import { css } from "@linaria/core";
import React from "react";

import { textStyles } from "#src/app/design-system/text-styles.js";
import type { Player } from "#src/app/player/narration-track-player.js";
import { usePlayerState } from "#src/app/player/player-host-provider.js";
import { composeClassnames } from "#src/app/utils.js";

/** The loaded audiobook's playback failure, such as a refused start or save. */
export function PlaybackError({ player }: { player: Player }): React.ReactNode {
  const message = usePlayerState(player, (state) => state.error);
  if (!message) {
    return null;
  }

  return <PlaybackErrorMessage message={message} />;
}

/** A playback failure without a loaded audiobook, such as a track that no longer exists. */
export function PlaybackErrorMessage({ message }: { message: string }): React.JSX.Element {
  return (
    <p
      role="alert"
      className={composeClassnames(
        textStyles.tagline,
        css`
          color: var(--color-error);
        `,
      )}
    >
      {message}
    </p>
  );
}
