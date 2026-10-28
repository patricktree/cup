import { css } from "@linaria/core";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Navigate, Outlet } from "@tanstack/react-router";
import React from "react";

import { AccountAvatar } from "#src/app/components/account-avatar.js";
import { AccountTabBar, TAB_BAR_HEIGHTS } from "#src/app/components/account-tab-bar.js";
import { fadeFooterClearance } from "#src/app/components/fade-footer.js";
import { MiniPlayer } from "#src/app/components/mini-player.js";
import { RecentsCard } from "#src/app/components/recents-card.js";
import { DSButton } from "#src/app/design-system/button.js";
import { textStyles } from "#src/app/design-system/text-styles.js";
import { interTypefaceScope } from "#src/app/global-styles.js";
import { useIsInScrollReach } from "#src/app/use-is-in-scroll-reach.js";
import { useMasonryRowSpans } from "#src/app/use-masonry-row-spans.js";
import { composeClassnames } from "#src/app/utils.js";
import { useAccountSession, useAccountAuthState } from "#src/auth/hooks.js";
import { createAccountHistoryQuery } from "#src/data-fetching/account-history.js";
import { describeError } from "#src/errors.js";

export const Route = createFileRoute("/_shell/recent")({
  component: RecentPage,
});

function RecentPage(): React.ReactNode {
  const session = useAccountSession();
  const authState = useAccountAuthState();
  const recents = useInfiniteQuery(createAccountHistoryQuery(session?.user.id));
  const masonryRef = useMasonryRowSpans();
  const [sentinelRef, isSentinelInReach] = useIsInScrollReach();

  const { hasNextPage, isFetching, isFetchNextPageError, fetchNextPage } = recents;
  // Keeps loading while the end of the list stays in reach, one page at a time. A failed page waits
  // for the Retry button below, so a persistent failure does not request the page in a loop.
  React.useEffect(() => {
    if (isSentinelInReach && hasNextPage && !isFetching && !isFetchNextPageError) {
      void fetchNextPage();
    }
  }, [isSentinelInReach, hasNextPage, isFetching, isFetchNextPageError, fetchNextPage]);

  // Only accounts have Recents; signed-out listeners, including on the Add dialog, start at home.
  if (authState.status === "signed-out") {
    return <Navigate to="/" replace />;
  }

  const items = recents.data?.pages.flatMap((page) => page.items);

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
          {authState.status === "loading" && <output>Loading account…</output>}
          {authState.status === "error" && <p role="alert">{authState.error.message}</p>}
          {recents.isLoading && <output>Loading tracks…</output>}
          {/* Once tracks are listed, a failed refresh or next page is reported with a toast. */}
          {recents.error && !recents.data && (
            <>
              <RecentsLoadError error={recents.error} />
              <DSButton disabled={recents.isFetching} onClick={() => void recents.refetch()}>
                Retry
              </DSButton>
            </>
          )}
          {items?.length === 0 && <EmptyRecents />}
          {items !== undefined && items.length > 0 && (
            // the container for the column count's container queries below
            <div
              className={css`
                container-type: inline-size;
              `}
            >
              <ul
                ref={masonryRef}
                aria-label="Tracks"
                className={css`
                  --columns: 2;

                  display: grid;
                  grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
                  gap: var(--spacing-gutter);
                  padding: 0;
                  margin: 0;
                  list-style: none;

                  /* each item spans its height in 1 px rows plus the gap, see useMasonryRowSpans */
                  &[data-masonry] {
                    grid-auto-rows: 1px;
                    row-gap: 0;
                  }

                  /* another column once it fits at the drawn card width of 183 px */
                  @container (width >= 573px) {
                    --columns: 3;
                  }

                  @container (width >= 768px) {
                    --columns: 4;
                  }
                `}
              >
                {items.map((item) => (
                  <RecentsCard key={item.conversionId} item={item} />
                ))}
              </ul>
              {/* loads the next page once the end of the list comes within about one screen */}
              {recents.hasNextPage && <div ref={sentinelRef} />}
              {recents.isFetchNextPageError && (
                <DSButton
                  disabled={recents.isFetching}
                  onClick={() => void recents.fetchNextPage()}
                >
                  Retry
                </DSButton>
              )}
            </div>
          )}
        </main>
      </div>
      <MiniPlayer />
      <AccountTabBar />
      {/* the Add dialog (`_shell.recent.add.tsx`) opens over Recents */}
      <Outlet />
    </>
  );
}

function EmptyRecents(): React.JSX.Element {
  return (
    <p
      className={css`
        display: grid;
        margin: auto;
        text-align: center;
      `}
    >
      <span
        className={composeClassnames(
          textStyles.paragraph,
          css`
            color: var(--color-ink-40);
          `,
        )}
      >
        Don’t be shy!
      </span>
      <Link
        to="/recent/add"
        state={{ isAddDialogOpenedInApp: true }}
        className={composeClassnames(
          textStyles.h3,
          css`
            color: var(--color-ink);
            text-decoration: underline;
          `,
        )}
      >
        Add your first track
      </Link>
    </p>
  );
}

function RecentsLoadError({ error }: { error: unknown }): React.ReactNode {
  const description = describeError(error, "Your tracks could not be loaded.");

  return (
    <p role="alert">
      {description.title} {description.detail}
    </p>
  );
}

/** The header and the list share the page's width and the drawn 12 px inline padding. */
const pageWidth = css`
  width: 100%;
  max-width: var(--app-max-width);
  padding-inline: var(--spacing-gutter);
  margin-inline: auto;
`;
