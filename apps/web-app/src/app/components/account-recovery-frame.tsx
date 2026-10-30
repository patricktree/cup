import { css } from "@linaria/core";
import React from "react";

import { Main } from "#src/app/components/main.tsx";
import { textStyles } from "#src/app/design-system/text-styles.js";
import { interTypefaceScope } from "#src/app/global-styles.js";
import { composeClassnames } from "#src/app/utils.js";

/** The account recovery page around its content, or the loading state or error in its place. */
export function AccountRecoveryFrame({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Main
      {...interTypefaceScope}
      className={css`
        display: grid;
        gap: calc(2 * var(--spacing-base));
        align-content: center;
        max-width: var(--app-max-width);
        min-height: 100dvh;
        padding-block: var(--app-padding-block);
        padding-inline: var(--app-padding-inline);
        margin-inline: auto;
      `}
    >
      <h1
        className={composeClassnames(
          textStyles.h1,
          css`
            margin: 0;
          `,
        )}
      >
        Restore your account
      </h1>
      {children}
    </Main>
  );
}
