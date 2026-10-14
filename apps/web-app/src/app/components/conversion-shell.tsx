import { css } from "@linaria/core";
import React from "react";

import { Main } from "#src/app/components/main.tsx";

type ConversionShellProps = {
  children: React.ReactNode;
};

export function ConversionShell({ children }: ConversionShellProps): React.JSX.Element {
  return (
    <Main
      className={css`
        display: grid;
        align-content: center;
        max-width: var(--app-max-width);
        height: 100dvh;
        padding-block: var(--app-padding-block);
        padding-inline: var(--app-padding-inline);
        margin-inline: auto;
      `}
    >
      <div
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
      </div>
      {children}
    </Main>
  );
}
