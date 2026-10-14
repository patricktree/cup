import { css } from "@linaria/core";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import React from "react";

import { FloatingPlayer } from "#src/app/components/floating-player.tsx";
import { Main } from "#src/app/components/main.tsx";
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
          grid-template-rows: minmax(0, 1fr) auto;
          height: 100dvh;
        `}
      >
        <Main
          className={css`
            display: grid;
            align-content: start;
            width: 100%;
            max-width: var(--app-max-width);
            padding-block: var(--app-padding-block);
            padding-inline: var(--app-padding-inline);
            margin-inline: auto;
          `}
        >
          <Outlet />
        </Main>
        <FloatingPlayer />
      </div>
    </PlayerHostProvider>
  );
}
