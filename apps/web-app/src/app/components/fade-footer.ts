import { css } from "@linaria/core";

/** The heights of a fade footer, which set its `--fade-height` and the clearance above it. */
type FadeFooterHeights = {
  /** Height of the drawn fade, from its transparent top down to the footer's top edge. */
  fadeHeightPixels: number;
};

/**
 * Bottom padding of the page above a fade footer, so its last content ends where the fade begins.
 * The footer has its own row below the page, so only the fade reaches over the page.
 */
export function fadeFooterClearance({ fadeHeightPixels }: FadeFooterHeights): string {
  return `${fadeHeightPixels}px`;
}

/**
 * Distance from the screen's bottom edge to the end of the content of every fade footer's controls.
 * A footer whose controls have padding of their own subtracts it from its bottom padding.
 */
export const FADE_FOOTER_CONTROLS_END_DISTANCE_PIXELS = 24;

/**
 * A bar stuck to the bottom of the screen, during a view transition. It is fixed there instead,
 * because the browser measures sticky positions against the snapshot, which extends under a bottom
 * browser toolbar and would draw the bar that much lower; the shell keeps a row for the bar's place
 * in the page. It also takes the name in `--bottom-bar-transition-name`, for a snapshot of its own
 * that the global styles draw above a moving cover.
 */
export const bottomBarDuringViewTransition = css`
  :root:active-view-transition & {
    position: fixed;
    inset-inline: 0;
    view-transition-name: var(--bottom-bar-transition-name);
  }
`;

/**
 * A bar fixed at the bottom of a shell page on the drawn transparent-to-white fade, which reaches
 * over the end of shell `<main>` above the bar. The element sets `--fade-height` and
 * `--fade-background`.
 */
export const fadeFooter = css`
  /* stays at the bottom of the screen while the document scrolls; also the fade's containing block */
  position: sticky;
  bottom: 0;

  /* above shell <main>, whose end scrolls under the fade */
  z-index: 1;

  &::before {
    position: absolute;
    inset-inline: 0;
    bottom: 100%;
    z-index: -1;
    height: var(--fade-height);

    /* let clicks reach the content fading underneath */
    pointer-events: none;
    content: "";
    background: var(--fade-background);
  }
`;
