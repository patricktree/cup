import { css } from "@linaria/core";
import { Link } from "@tanstack/react-router";
import React from "react";

import type { HistoryItem } from "@cup/listener-api.routes";

import { DSCoverImage } from "#src/app/design-system/cover-image.js";
import { pressableOverlay } from "#src/app/design-system/interaction-states.js";
import { textStyles } from "#src/app/design-system/text-styles.js";
import { toPreparationPhaseLabel } from "#src/app/preparation-phase-label.js";
import { toSourceHost } from "#src/app/source-host.js";
import type { MapPropsToRequiredDataAttributeProps } from "#src/app/styling.utils.js";
import { composeClassnames } from "#src/app/utils.js";

type CardCustomProps = {
  /** `muted`: the preparation phase or a failure line stands in for the title. */
  title: "ready" | "muted";
  cover: "shown" | "none";
};

/**
 * A track on Recents: a card linking to its detail view, with the source host below. Every state
 * with a narration document looks ready (title, then the cover when there is one); a pending
 * conversion shows its preparation phase and a failed one a short failure line instead of the
 * title.
 */
export function RecentsCard({ item }: { item: HistoryItem }): React.JSX.Element {
  const outcome = item.outcome?.status === "ready" ? item.outcome : undefined;
  const coverUrl = outcome?.coverImage?.url;
  const dataAttributes: MapPropsToRequiredDataAttributeProps<CardCustomProps> = {
    "data-title": outcome ? "ready" : "muted",
    "data-cover": coverUrl === undefined ? "none" : "shown",
  };

  return (
    // the list's masonry measures this item, which must not stretch to its grid area
    <li
      className={css`
        align-self: start;
      `}
    >
      <Link
        to="/audiobooks/$conversionId"
        params={{ conversionId: item.conversionId }}
        className={composeClassnames(
          pressableOverlay,
          css`
            display: grid;
            gap: 24px;
            padding-block: var(--spacing-gutter) 24px;
            overflow: hidden;

            color: var(--color-ink);
            text-decoration: none;
            background-color: var(--color-surface);
            border: 1px solid var(--color-ink-4);
            border-radius: var(--border-radius-lg);
            box-shadow: var(--shadow-card);

            &[data-title="muted"] {
              color: var(--color-ink-40);
            }

            /* the cover runs full-bleed to the card's bottom edge, which clips it */
            &[data-cover="shown"] {
              padding-block-end: 0;
            }

            & [data-shape] {
              border-radius: 0;
            }
          `,
        )}
        {...dataAttributes}
      >
        <span
          className={composeClassnames(
            textStyles.h3,
            css`
              padding-inline: var(--spacing-gutter);
              overflow-wrap: anywhere;
            `,
          )}
        >
          {outcome
            ? outcome.title
            : item.status === "pending"
              ? toPreparationPhaseLabel(item.preparationPhase)
              : "Couldn't prepare this track"}
        </span>
        {/* the title names the card, so the cover is decorative */}
        {coverUrl !== undefined && <DSCoverImage src={coverUrl} alt="" />}
      </Link>
      <p
        className={composeClassnames(
          textStyles.tagline,
          css`
            padding: 10px;
            margin: 0;
            color: var(--color-ink-40);
            text-align: center;
            overflow-wrap: anywhere;
          `,
        )}
      >
        {toSourceHost(item.sourceUrl)}
      </p>
    </li>
  );
}
