import { QueryErrorResetBoundary } from "@tanstack/react-query";
import { CatchBoundary, type ErrorRouteComponent } from "@tanstack/react-router";
import React from "react";

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
