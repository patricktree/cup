import { css } from "@linaria/core";
import React from "react";

import { Main } from "#src/app/components/main.tsx";
import { CupLogoIcon } from "#src/app/design-system/icons.js";
import { textStyles } from "#src/app/design-system/text-styles.js";
import { interTypefaceScope } from "#src/app/global-styles.js";
import { composeClassnames } from "#src/app/utils.js";

type ConversionShellProps = {
  children: React.ReactNode;
};

export function ConversionShell({ children }: ConversionShellProps): React.JSX.Element {
  return (
    <Main
      {...interTypefaceScope}
      className={css`
        width: 100%;

        /* the design's phone column: a wider screen centers it, which keeps the wavy rule's drawing */
        max-width: 402px;
        min-height: 100dvh;

        /* the design starts the logo at 212 px of its 898 px height */
        padding-block: calc(212 / 898 * 100dvh) var(--app-padding-block);
        padding-inline: var(--spacing-gutter);
        margin-inline: auto;
      `}
    >
      <CupLogoIcon />
      <div
        className={css`
          margin-block-start: 48px;
          margin-inline: 4px;
        `}
      >
        <p
          className={composeClassnames(
            textStyles.h1,
            css`
              color: var(--color-fg-emphasized-sm);
            `,
          )}
        >
          No reading lists,
          <br />
          No tldr.
        </p>
        <h1
          className={composeClassnames(
            textStyles.h1,
            css`
              margin-block-start: 10px;
            `,
          )}
        >
          Just listen.
        </h1>
      </div>
      {children}
    </Main>
  );
}
