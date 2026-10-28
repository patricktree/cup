import { css } from "@linaria/core";
import React from "react";

type MainProps = React.ComponentProps<"main">;

/** The page's content; the document scrolls it (see the shell layout in `routes/_shell.tsx`). */
export function Main({ children, ...delegated }: MainProps): React.JSX.Element {
  return <main {...delegated}>{children}</main>;
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
          data-shell-header
          className={css`
            /* stays at the top of the screen while the document scrolls; also the fade's anchor */
            position: sticky;
            top: 0;

            /* put above shell <main> */
            z-index: 1;
            grid-area: shell-header;

            font-size: var(--font-size-xxxl);
            background-color: var(--color-bg);
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
