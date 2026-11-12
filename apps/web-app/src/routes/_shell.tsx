import { css } from "@linaria/core";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import React from "react";

import { PlayerHostProvider } from "#src/app/player/player-host-provider.tsx";
import { StatusAnnouncerProvider } from "#src/app/status-announcer.tsx";

export const Route = createFileRoute("/_shell")({
  component: ShellLayout,
});

function ShellLayout() {
  return (
    <PlayerHostProvider>
      <div
        className={css`
          /*
            The document scrolls, not an element in it: iOS Safari ties a pull-to-refresh gesture to
            the document, and an inner scroller would not move until that gesture had settled. The
            header and the footer below stick to the screen's edges.
          */
          display: grid;
          grid-template-areas:
            "shell-header"
            "shell-main"
            "shell-footer";
          grid-template-rows: max-content 1fr auto;
          min-height: 100dvh;
          /*
            The page reaches under the status bar and the notch (viewport-fit=cover in
            index.html), as the iOS app's WebView always does; keep the content out of them. The
            sticky header in main.tsx pulls its background back up into the top inset.
          */
          padding-block-start: env(safe-area-inset-top, 0);
          padding-inline: env(safe-area-inset-left, 0) env(safe-area-inset-right, 0);

          /* create stacking context for <header> and <main> of the shell */
          isolation: isolate;
        `}
      >
        <StatusAnnouncerProvider>
          <Outlet />
        </StatusAnnouncerProvider>
      </div>
    </PlayerHostProvider>
  );
}
