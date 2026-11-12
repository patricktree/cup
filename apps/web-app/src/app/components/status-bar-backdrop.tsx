import { css } from "@linaria/core";
import React from "react";

/**
 * Paints the page's background behind the status bar, which the page reaches under
 * (viewport-fit=cover in index.html), so scrolled content does not show through it. The strip is as
 * tall as the top safe area, so it takes no room where there is none, such as on a desktop.
 */
export function StatusBarBackdrop(): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      data-status-bar-backdrop=""
      className={css`
        position: fixed;
        inset: 0 0 auto;
        /* above the routes' content, also the shell's sticky header (components/main.tsx) */
        z-index: 1;
        height: env(safe-area-inset-top, 0);
        background-color: var(--color-bg);
      `}
    />
  );
}
