import { css } from "@linaria/core";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Navigate, Outlet } from "@tanstack/react-router";
import React from "react";

import { AccountAvatar } from "#src/app/components/account-avatar.js";
import { AccountTabBar } from "#src/app/components/account-tab-bar.js";
import { ShellContent } from "#src/app/components/main.tsx";
import { DSButton } from "#src/app/design-system/button.js";
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

  // Only accounts have Recents; signed-out listeners, including on the Add dialog, start at home.
  if (authState.status === "signed-out") {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      <ShellContent
        headerContent={
          <div
            className={css`
              display: flex;
              flex-grow: 1;
              flex-wrap: wrap;
              gap: var(--spacing-gutter);
              align-items: center;
              justify-content: space-between;
            `}
          >
            Recents
            {session && <AccountAvatar userMetadata={session.user.user_metadata} />}
          </div>
        }
        mainContent={
          <>
            <h1>Recents</h1>
            {authState.status === "loading" && <output>Loading account…</output>}
            {authState.status === "error" && <p role="alert">{authState.error.message}</p>}
            {recents.isLoading && <output>Loading conversions…</output>}
            {/* Once conversions are listed, a failed refresh or "Load more" is reported with a toast. */}
            {recents.error && !recents.data && (
              <>
                <RecentsLoadError error={recents.error} />
                <DSButton disabled={recents.isFetching} onClick={() => void recents.refetch()}>
                  Retry
                </DSButton>
              </>
            )}
            {recents.data && (
              <ul>
                {recents.data.pages
                  .flatMap((page) => page.items)
                  .map((item) => (
                    <li key={item.conversionId}>
                      <span>
                        {item.outcome?.status === "ready" ? item.outcome.title : item.sourceUrl}
                      </span>{" "}
                      {item.status === "ready" ? (
                        <Link
                          to="/audiobooks/$conversionId"
                          params={{ conversionId: item.conversionId }}
                        >
                          Open audiobook
                        </Link>
                      ) : item.status === "pending" ? (
                        <Link
                          to="/audiobooks/$conversionId"
                          params={{ conversionId: item.conversionId }}
                        >
                          Processing
                        </Link>
                      ) : item.status === "synthesizing" ? (
                        <Link
                          to="/audiobooks/$conversionId"
                          params={{ conversionId: item.conversionId }}
                        >
                          Generating audio
                        </Link>
                      ) : item.status === "insufficient-duration" ? (
                        <Link
                          to="/audiobooks/$conversionId"
                          params={{ conversionId: item.conversionId }}
                        >
                          Not enough audio duration
                        </Link>
                      ) : (
                        <span>
                          {item.outcome?.status === "failed"
                            ? item.outcome.explanation
                            : "Conversion failed."}
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
            )}
            {recents.data?.pages[0]?.items.length === 0 && (
              <p>Your conversions will appear here.</p>
            )}
            {recents.hasNextPage && (
              <DSButton
                disabled={recents.isFetchingNextPage}
                onClick={() => recents.fetchNextPage()}
              >
                Load more
              </DSButton>
            )}
          </>
        }
      ></ShellContent>
      <AccountTabBar />
      {/* the Add dialog (`_shell.recent.add.tsx`) opens over Recents */}
      <Outlet />
    </>
  );
}

function RecentsLoadError({ error }: { error: unknown }): React.ReactNode {
  const description = describeError(error, "Your conversions could not be loaded.");

  return (
    <p role="alert">
      {description.title} {description.detail}
    </p>
  );
}
