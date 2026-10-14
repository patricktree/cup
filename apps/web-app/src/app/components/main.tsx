import { css } from "@linaria/core";
import React from "react";

import { composeClassnames } from "#src/app/utils.ts";

type MainProps = {
  children: React.ReactNode;
  className?: string;
};

export function Main({ children, className }: MainProps): React.JSX.Element {
  return (
    <main
      // stable key under which the router's scroll restoration stores this container's position
      data-scroll-restoration-id="main"
      className={composeClassnames(
        className,
        css`
          /* scrolls its content instead of the document; callers give it a height bound to the viewport */
          overflow-y: auto;
        `,
      )}
    >
      {children}
    </main>
  );
}
