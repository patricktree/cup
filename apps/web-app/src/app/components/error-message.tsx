import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import React from "react";

import { DSButton } from "#src/app/design-system/button.js";
import { describeError, type DescribeApiRefusal } from "#src/errors.js";

function ErrorMessage({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <h1>{title}</h1>
      <div>{children}</div>
    </div>
  );
}

/** Replaces a page that has nothing to show because loading it failed. */
export function ErrorScreen({
  error,
  fallbackTitle,
  describeApiRefusal,
  onRetry,
}: {
  error: unknown;
  fallbackTitle: string;
  describeApiRefusal?: DescribeApiRefusal;
  onRetry: () => void;
}): React.JSX.Element {
  const description = describeError(error, fallbackTitle, describeApiRefusal);

  return (
    <ErrorMessage title={description.title}>
      {description.detail}
      {description.isRetryable ? (
        <DSButton type="button" variant="contained" onClick={onRetry}>
          Try again
        </DSButton>
      ) : null}
    </ErrorMessage>
  );
}

/** Error screen for routes without their own; trying again reruns the route loaders. */
export function RouteErrorScreen({ error }: ErrorComponentProps): React.JSX.Element {
  const router = useRouter();

  return (
    <ErrorScreen
      error={error}
      fallbackTitle="This page could not be loaded."
      // Invalidating also resets the error boundary that rendered this screen.
      onRetry={() => void router.invalidate()}
    />
  );
}
