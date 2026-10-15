import { css } from "@linaria/core";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import React from "react";

import { FloatingPlayer } from "#src/app/components/floating-player.tsx";
import { PlayerHostProvider } from "#src/app/player/player-host-provider.tsx";

export const Route = createFileRoute("/_shell")({
  component: ShellLayout,
});

function ShellLayout() {
  return (
    <PlayerHostProvider>
      <div
        className={css`
          /* the page scrolls within its row, so the player below it never covers content */
          display: grid;
          grid-template-areas:
            "shell-header"
            "shell-main"
            "shell-floating-player";
          grid-template-rows: max-content minmax(0, 1fr) auto;
          height: 100dvh;

          /* create stacking context for <header> and <main> of the shell */
          isolation: isolate;
        `}
      >
        <Outlet />
        <FloatingPlayer />
      </div>
    </PlayerHostProvider>
  );
}
