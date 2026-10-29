import { css } from "@linaria/core";
import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Navigate,
  Outlet,
  redirect,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import React from "react";

import { RecentsCard } from "#src/app/components/recents-card.js";
import { RecentsLayout } from "#src/app/components/recents-layout.js";
import { DSButton } from "#src/app/design-system/button.js";
import { textStyles } from "#src/app/design-system/text-styles.js";
import { useIsInScrollReach } from "#src/app/use-is-in-scroll-reach.js";
import { useMasonryRowSpans } from "#src/app/use-masonry-row-spans.js";
import { useRetryRoute } from "#src/app/use-retry-route.js";
import { composeClassnames } from "#src/app/utils.js";
import { settleAccountSession } from "#src/auth/account-session.js";
import { useAccountSession } from "#src/auth/hooks.js";
import { createAccountHistoryQuery } from "#src/data-fetching/account-history.js";
import { describeError } from "#src/errors.js";

export const Route = createFileRoute("/_shell/recent")({
  component: RecentPage,
  beforeLoad: async () => {
    // Only accounts have Recents; signed-out listeners, including on its dialogs, start at home.
    const session = await settleAccountSession();
    if (!session) {
      throw redirect({ to: "/", replace: true });
    }
    // Only the subject: query options built here would outlive an account switch.
    return { subject: session.user.id };
  },
  loader: async ({ context }) => {
    await context.queryClient.infiniteQuery({
      ...createAccountHistoryQuery(context.subject),
      staleTime: "static",
    });
  },
  pendingComponent: RecentsPending,
  errorComponent: RecentsError,
});

function RecentPage(): React.ReactNode {
  const session = useAccountSession();

  // Signing out while Recents is shown leaves it; the route sends a signed-out visit home itself.
  if (!session) {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      <RecentsLayout>
        <RecentTracks subject={session.user.id} />
      </RecentsLayout>
      {/* the Add and account dialogs (`_shell.recent.add.tsx`, `_shell.recent.account.tsx`) open
          over Recents */}
      <Outlet />
    </>
  );
}

function RecentsPending(): React.JSX.Element {
  return (
    <RecentsLayout>
      <output data-loading-state="">Loading tracks…</output>
    </RecentsLayout>
  );
}

function RecentsError({ error }: ErrorComponentProps): React.JSX.Element {
  const retry = useRetryRoute();

  return (
    <RecentsLayout>
      <RecentsLoadError error={error} />
      <DSButton onClick={retry}>Retry</DSButton>
    </RecentsLayout>
  );
}

function RecentTracks({ subject }: { subject: string }): React.ReactNode {
  const recents = useSuspenseInfiniteQuery(createAccountHistoryQuery(subject));
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

  // Once tracks are listed, a failed refresh or next page is reported with a toast.
  const items = recents.data.pages.flatMap((page) => page.items);

  if (items.length === 0) {
    return <EmptyRecents />;
  }

  return (
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
        <DSButton disabled={recents.isFetching} onClick={() => void recents.fetchNextPage()}>
          Retry
        </DSButton>
      )}
    </div>
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
        state={{ isRecentsDialogOpenedInApp: true }}
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
