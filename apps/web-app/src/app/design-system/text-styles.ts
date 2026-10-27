import { css } from "@linaria/core";

/**
 * The text styles of the Recents and detail-view designs, all in Inter. Each sets its own font
 * family, so it also applies to elements the global Space Mono rule reaches.
 */
export const textStyles = {
  /** Screen title, such as "Recent". */
  h1: css`
    font-family: var(--font-family-1);
    font-size: var(--font-size-xxxl);
    font-weight: var(--font-weight-inter-figma-medium);
    line-height: var(--line-height-h1);
    letter-spacing: var(--letter-spacing-tight);
  `,
  /** Audiobook title in the detail view. */
  h2: css`
    font-family: var(--font-family-1);
    font-size: var(--font-size-xxl);
    font-weight: var(--font-weight-inter-figma-medium);
    line-height: var(--line-height-h2);
    letter-spacing: var(--letter-spacing-tight);
  `,
  /** Card titles. */
  h3: css`
    font-family: var(--font-family-1);
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-inter-figma-medium);
    line-height: var(--line-height-h3);
    letter-spacing: var(--letter-spacing-tight);
  `,
  /** Subheadings. */
  h4: css`
    font-family: var(--font-family-1);
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-inter-figma-medium);
    line-height: var(--line-height-h4);
  `,
  /** Mini player title and the player sheet's status line. */
  h5: css`
    font-family: var(--font-family-1);
    font-size: var(--font-size-md);
    font-weight: var(--font-weight-inter-figma-medium);
    line-height: var(--line-height-h5);
    letter-spacing: var(--letter-spacing-tight);
  `,
  /** Article body. */
  paragraph: css`
    font-family: var(--font-family-1);
    font-size: var(--font-size-lg);
    font-weight: 400;
    line-height: var(--line-height-paragraph);
  `,
  /** Source host under cards and in the detail view. */
  tagline: css`
    font-family: var(--font-family-1);
    font-size: var(--font-size-sm);
    font-weight: 400;
    line-height: var(--line-height-tagline);
  `,
  /** Tab captions and the mini player's host. */
  label: css`
    font-family: var(--font-family-1);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-inter-figma-medium);
    line-height: var(--line-height-label);
    letter-spacing: var(--letter-spacing-tight);
  `,
  /** Unnamed in the designs: the empty-state text on Recents, the only 20 px text. */
  callout: css`
    font-family: var(--font-family-1);
    font-size: var(--font-size-xl);
    font-weight: var(--font-weight-inter-figma-medium);
    line-height: var(--line-height-h5);
    letter-spacing: var(--letter-spacing-tight);
  `,
} as const;
