import { css } from "@linaria/core";
import React from "react";

import { AccountAvatar } from "#src/app/components/account-avatar.js";
import { AccountTabBar, TAB_BAR_HEIGHTS } from "#src/app/components/account-tab-bar.js";
import { fadeFooterClearance } from "#src/app/components/fade-footer.js";
import { MiniPlayer } from "#src/app/components/mini-player.js";
import { textStyles } from "#src/app/design-system/text-styles.js";
import { interTypefaceScope } from "#src/app/global-styles.js";
import { composeClassnames } from "#src/app/utils.js";
import { useAccountSession } from "#src/auth/hooks.js";

/** Recents' header, tab bar and mini player, around the tracks or what shows in their place. */
export function RecentsLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  const session = useAccountSession();

  return (
    <>
      {/* the header scrolls away with the tracks, unlike other shell pages' sticky headers */}
      <div
        className={css`
          grid-area: shell-main;
        `}
      >
        <header
          {...interTypefaceScope}
          className={composeClassnames(
            pageWidth,
            css`
              /* put above shell <main> */
              z-index: 1;
              display: flex;
              grid-area: shell-header;
              gap: var(--spacing-gutter);
              align-items: center;
              justify-content: space-between;
              min-height: 44px;
              padding-block-start: var(--spacing-gutter);
            `,
          )}
        >
          <h1
            className={composeClassnames(
              textStyles.h1,
              css`
                padding-block-end: 8px;
                padding-inline-start: var(--spacing-gutter);
                margin: 0;
              `,
            )}
          >
            Recent
          </h1>
          {session && <AccountAvatar userMetadata={session.user.user_metadata} />}
        </header>
        <main
          {...interTypefaceScope}
          className={composeClassnames(
            pageWidth,
            css`
              display: flex;
              flex-direction: column;
              grid-area: shell-main;
              padding-block: 24px;

              /* the tab bar's fade reaches this far over the end of <main> */
              padding-block-end: ${fadeFooterClearance(TAB_BAR_HEIGHTS)};
            `,
          )}
        >
          {children}
        </main>
      </div>
      {/* the mini player stacks on the tab bar, so it needs no offset from the tab bar's height */}
      <div
        className={css`
          /* stays at the bottom of the screen while the document scrolls */
          position: sticky;
          bottom: 0;

          /* above shell <main>, whose end scrolls under the tab bar's fade */
          z-index: 1;
          display: grid;
          grid-area: shell-footer;
        `}
      >
        <MiniPlayer />
        <AccountTabBar />
      </div>
    </>
  );
}

/** The header and the list share the page's width and the drawn 12 px inline padding. */
const pageWidth = css`
  width: 100%;
  max-width: var(--app-max-width);
  padding-inline: var(--spacing-gutter);
  margin-inline: auto;
`;
