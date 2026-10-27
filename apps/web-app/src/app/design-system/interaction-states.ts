import { css } from "@linaria/core";

/**
 * The undrawn pressed and hover state of the redesigned controls: an 8 % ink overlay in the
 * element's own shape, on hover only for pointers that can hover. The focus ring is global (see
 * `global-styles.ts`).
 */
export const pressableOverlay = css`
  /* containing block for the overlay below */
  position: relative;

  &::after {
    position: absolute;
    inset: 0;

    pointer-events: none;
    content: "";
    background-color: var(--color-ink-8);
    border-radius: inherit;
    opacity: 0;
  }

  &:active:not(:disabled, [aria-disabled="true"])::after {
    opacity: 1;
  }

  @media (hover: hover) {
    &:hover:not(:disabled, [aria-disabled="true"])::after {
      opacity: 1;
    }
  }
`;
