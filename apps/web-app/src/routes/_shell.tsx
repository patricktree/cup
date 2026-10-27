import { css } from "@linaria/core";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import React from "react";

import { PlayerHostProvider } from "#src/app/player/player-host-provider.tsx";

export const Route = createFileRoute("/_shell")({
  component: ShellLayout,
});

function ShellLayout() {
  return (
    <PlayerHostProvider>
      <div
        className={css`
          /* the page scrolls within its row; the player and tab bar below it fade over its end */
          display: grid;
          grid-template-areas:
            "shell-header"
            "shell-main"
            "shell-player"
            "shell-tab-bar";
          grid-template-rows: max-content minmax(0, 1fr) auto auto;
          height: 100dvh;

          /* create stacking context for <header> and <main> of the shell */
          isolation: isolate;
        `}
      >
        <Outlet />
      </div>
    </PlayerHostProvider>
  );
}
