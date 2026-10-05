import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import React from "react";

import { DSButton } from "#src/app/design-system/button.js";
import { useAccountSession, useAccountAuthState } from "#src/auth/hooks.js";
import { createAccountHistoryQuery } from "#src/data-fetching/account-history.js";

export const Route = createFileRoute("/history")({
  component: HistoryPage,
});

function HistoryPage(): React.ReactNode {
  const session = useAccountSession();
  const authState = useAccountAuthState();
  const history = useInfiniteQuery(createAccountHistoryQuery(session?.user.id));
  return (
    <>
      <h1>Conversion history</h1>
      {authState.status === "loading" && <output>Loading account…</output>}
      {authState.status === "error" && <p role="alert">{authState.error.message}</p>}
      {authState.status === "signed-out" && <p>Sign in to see your conversions.</p>}
      {history.isLoading && <output>Loading conversions…</output>}
      {history.error && (
        <>
          <p role="alert">{history.error.message}</p>
          <DSButton disabled={history.isFetching} onClick={() => void history.refetch()}>
            Retry history
          </DSButton>
        </>
      )}
      {history.data && (
        <ul>
          {history.data.pages
            .flatMap((page) => page.items)
            .map((item) => (
              <li key={item.conversionId}>
                <span>
                  {item.outcome?.status === "ready" ? item.outcome.title : item.sourceUrl}
                </span>{" "}
                {item.status === "ready" ? (
                  <Link to="/audiobooks/$conversionId" params={{ conversionId: item.conversionId }}>
                    Open audiobook
                  </Link>
                ) : item.status === "pending" ? (
                  <Link to="/audiobooks/$conversionId" params={{ conversionId: item.conversionId }}>
                    Processing
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
      {history.data?.pages[0]?.items.length === 0 && <p>Your conversions will appear here.</p>}
      {history.hasNextPage && (
        <DSButton disabled={history.isFetchingNextPage} onClick={() => history.fetchNextPage()}>
          Load more
        </DSButton>
      )}
    </>
  );
}
