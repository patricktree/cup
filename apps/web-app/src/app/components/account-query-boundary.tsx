import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import type { ErrorComponentProps } from "@tanstack/react-router";
import React from "react";

import { RpcError } from "@cup/web-app-api.client";

import { QueryBoundary } from "#src/app/components/query-boundary.js";
import { DSButton } from "#src/app/design-system/button.js";
import { useRateLimitCountdown } from "#src/data-fetching/rate-limit.js";

export function AccountQueryBoundary({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <QueryBoundary pending={<output>Loading account…</output>} errorComponent={AccountSetupError}>
      {children}
    </QueryBoundary>
  );
}

function AccountSetupError({ error, reset }: ErrorComponentProps): React.ReactNode {
  const { reset: resetQuery } = useQueryErrorResetBoundary();
  const retryIn = useRateLimitCountdown(error);
  return (
    <>
      <p role="alert">
        {error instanceof RpcError && error.status === 429
          ? "Too many new accounts from this connection. Your sign-in is retained; try again after the countdown."
          : "Account setup is still pending."}
      </p>
      {retryIn > 0 && <output>Try again in {retryIn} seconds.</output>}
      <DSButton
        disabled={retryIn > 0}
        onClick={() => {
          resetQuery();
          reset();
        }}
      >
        Retry setup
      </DSButton>
    </>
  );
}
