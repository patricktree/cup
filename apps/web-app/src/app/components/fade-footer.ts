import { css } from "@linaria/core";

/**
 * A bar fixed at the bottom of a shell page on the drawn transparent-to-white fade, which reaches
 * over the end of shell `<main>` above the bar. The element sets `--fade-height` and
 * `--fade-background`.
 */
export const fadeFooter = css`
  /* containing block for the fade below */
  position: relative;

  /* above shell <main>, whose end scrolls under the fade */
  z-index: 1;

  &::before {
    position: absolute;
    inset-inline: 0;
    bottom: 0;
    z-index: -1;
    height: var(--fade-height);

    /* let clicks reach the content fading underneath */
    pointer-events: none;
    content: "";
    background: var(--fade-background);
  }
`;
