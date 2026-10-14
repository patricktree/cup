import { QueryErrorResetBoundary, useQueryErrorResetBoundary } from "@tanstack/react-query";
import {
  CatchBoundary,
  type ErrorComponentProps,
  type ErrorRouteComponent,
} from "@tanstack/react-router";
import React from "react";

import { ErrorScreen } from "#src/app/components/error-message.js";

export function QueryBoundary({
  children,
  pending,
  errorComponent: ErrorComponent,
}: {
  children: React.ReactNode;
  pending: React.ReactNode;
  errorComponent: ErrorRouteComponent;
}): React.ReactNode {
  return (
    <QueryErrorResetBoundary>
      <CatchBoundary getResetKey={() => "query"} errorComponent={ErrorComponent}>
        <React.Suspense fallback={pending}>{children}</React.Suspense>
      </CatchBoundary>
    </QueryErrorResetBoundary>
  );
}

/** Error screen for a `QueryBoundary`; trying again refetches the queries that failed. */
export function QueryErrorScreen({
  error,
  reset,
  fallbackTitle,
}: ErrorComponentProps & { fallbackTitle: string }): React.JSX.Element {
  const queryBoundary = useQueryErrorResetBoundary();

  return (
    <ErrorScreen
      error={error}
      fallbackTitle={fallbackTitle}
      onRetry={() => {
        queryBoundary.reset();
        reset();
      }}
    />
  );
}
