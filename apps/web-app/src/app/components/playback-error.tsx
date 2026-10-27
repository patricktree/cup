import { css } from "@linaria/core";
import React from "react";

import type { Player } from "#src/app/player/narration-track-player.js";
import { usePlayerState } from "#src/app/player/player-host-provider.js";

/** The loaded audiobook's playback failure, such as a refused start or save. */
export function PlaybackError({ player }: { player: Player }): React.ReactNode {
  const message = usePlayerState(player, (state) => state.error);
  if (!message) {
    return null;
  }

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
