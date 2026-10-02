import { css } from "@linaria/core";
import React from "react";

export function ConversionEntryPage({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={css`
        display: grid;
        gap: calc(3 * var(--spacing-base));
        width: 100%;
      `}
    >
      <header
        className={css`
          text-align: center;
        `}
      >
        <p
          className={css`
            font-family: var(--font-family-2);
            font-size: var(--font-size-lg);
            color: var(--color-fg-emphasized-sm);
          `}
        >
          No reading lists, no tldr.
        </p>
        <h1
          className={css`
            font-size: var(--font-size-display);
            font-weight: var(--font-weight-inter-figma-medium);
            line-height: var(--line-height-display);
          `}
        >
          Just listen.
        </h1>
      </header>
      {children}
    </div>
  );
}
