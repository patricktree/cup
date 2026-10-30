import { css } from "@linaria/core";
import React from "react";

import { Main } from "#src/app/components/main.tsx";

/** A whole page's loading state, for a route whose screen has no layout to show before its data. */
export function PageSkeleton({ label }: { label: string }): React.JSX.Element {
  return (
    <Main
      aria-busy="true"
      aria-label={label}
      data-loading-state=""
      className={css`
        min-height: 100dvh;
      `}
    />
  );
}
