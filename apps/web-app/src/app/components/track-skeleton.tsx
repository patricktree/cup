import { css } from "@linaria/core";
import React from "react";

/**
 * Shown while the audiobook loads, and in the same shape while its conversion is still preparing.
 * Only loading is a loading state: a conversion being prepared is the content the server sent.
 */
export function TrackSkeleton({
  label,
  isLoadingState,
}: {
  label: "Loading track" | "Preparing track";
  isLoadingState: boolean;
}): React.JSX.Element {
  return (
    <section
      aria-busy="true"
      aria-label={label}
      data-loading-state={isLoadingState ? "" : undefined}
    >
      <div
        aria-hidden="true"
        className={css`
          display: grid;
          gap: var(--spacing-gutter);

          & > div {
            height: 24px;
            background-color: var(--color-placeholder);
            border-radius: var(--border-radius-full);
          }

          & > div:first-child {
            height: auto;
            aspect-ratio: 5 / 3;
            margin-block-end: calc(2 * var(--spacing-gutter));
            border-radius: var(--border-radius-lg);
          }
        `}
      >
        <div />
        <div />
        <div />
        <div />
        <div />
      </div>
    </section>
  );
}
