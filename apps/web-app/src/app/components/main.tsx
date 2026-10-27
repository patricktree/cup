import { css } from "@linaria/core";
import React from "react";

import { composeClassnames } from "#src/app/utils.ts";

type MainProps = React.ComponentProps<"main">;

export function Main({ children, className, ...delegated }: MainProps): React.JSX.Element {
  return (
    <main
      {...delegated}

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

type ShellContentProps = {
  headerContent?: React.ReactNode;
  mainContent: React.ReactNode;
  /** Room below the content, for a footer that fades over the page's end. */
  mainPaddingBlockEnd?: string | undefined;
};

export function ShellContent({
  headerContent,
  mainContent,
  mainPaddingBlockEnd,
}: ShellContentProps): React.JSX.Element {
  return (
    <>
      {headerContent && (
        <header
          className={css`
            /* positioning anchor for absolutely-positioned fading child element */
            position: relative;

            /* put above shell <main> */
            z-index: 1;
            grid-area: shell-header;

            font-size: var(--font-size-xxxl);
          `}
        >
          <div
            className={css`
              display: flex;
              align-items: center;
              width: 100%;
              max-width: var(--app-max-width);
              padding-block: var(--app-padding-block);
              padding-inline: var(--app-padding-inline);
              margin-inline: auto;
            `}
          >
            {headerContent}
          </div>
          <div
            className={css`
              position: absolute;
              top: 100%;
              width: 100%;
              height: var(--app-padding-block);

              /* let clicks reach the content fading underneath */
              pointer-events: none;
              background-image: linear-gradient(to bottom, var(--color-bg), transparent);
            `}
          />
        </header>
      )}

      <Main
        className={css`
          display: grid;
          grid-area: var(--grid-area);
          align-content: start;
          width: 100%;
          max-width: var(--app-max-width);
          padding-block: var(--app-padding-block) var(--padding-block-end);
          padding-inline: var(--app-padding-inline);
          margin-inline: auto;
        `}
        style={{
          ["--grid-area"]: headerContent ? "shell-main" : "shell-header / shell-main",
          ["--padding-block-end"]: mainPaddingBlockEnd ?? "var(--app-padding-block)",
        }}
      >
        {mainContent}
      </Main>
    </>
  );
}
