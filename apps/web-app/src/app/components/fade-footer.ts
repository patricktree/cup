import { css } from "@linaria/core";

/** The heights of a fade footer, which set its `--fade-height` and the clearance above it. */
type FadeFooterHeights = {
  /** Height of the drawn fade, from its transparent top down to the footer's top edge. */
  fadeHeightPixels: number;
  /** The footer's own row, below the fade. */
  footerHeightPixels: number;
};

/**
 * Bottom padding of the page above a fade footer, so its last content ends where the fade begins.
 * The footer has its own row below the page, so only the fade reaches over the page.
 */
export function fadeFooterClearance({ fadeHeightPixels }: FadeFooterHeights): string {
  return `${fadeHeightPixels}px`;
}

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
