import { css } from "@linaria/core";
import { createLink, Link } from "@tanstack/react-router";
import React from "react";

import {
  FADE_FOOTER_PADDING_BLOCK_END_PIXELS,
  fadeFooter,
} from "#src/app/components/fade-footer.js";
import { TabAddIcon, TabRecentIcon } from "#src/app/design-system/icons.js";
import { pressableOverlay } from "#src/app/design-system/interaction-states.js";
import { textStyles } from "#src/app/design-system/text-styles.js";
import { interTypefaceScope } from "#src/app/global-styles.js";
import { composeClassnames } from "#src/app/utils.js";

const PADDING_BLOCK_START_PIXELS = 24;
const TAB_PADDING_PIXELS = 5;
/** The tabs' padding counts towards the fade footers' shared distance from the screen's bottom edge. */
const PADDING_BLOCK_END_PIXELS = FADE_FOOTER_PADDING_BLOCK_END_PIXELS - TAB_PADDING_PIXELS;
/** The tab bar's fade. The page above leaves `fadeFooterClearance(TAB_BAR_HEIGHTS)` free at its end. */
export const TAB_BAR_HEIGHTS = {
  fadeHeightPixels: 50,
} as const;

/** Distance from the top of the tab bar down to its tab icons. */
export const TAB_BAR_ICONS_OFFSET_PIXELS = PADDING_BLOCK_START_PIXELS + TAB_PADDING_PIXELS;

/**
 * Tabs of Recents, at the bottom of the page on the drawn fade. The tab of the current page is at
 * full ink; Add opens the Add dialog and, being an action, never shows as current.
 */
export function AccountTabBar(): React.JSX.Element {
  return (
    <nav
      {...interTypefaceScope}
      aria-label="Tabs"
      className={composeClassnames(
        fadeFooter,
        css`
          --fade-height: ${TAB_BAR_HEIGHTS.fadeHeightPixels}px;
          --fade-background: var(--background-fade-tab-bar);

          padding: ${PADDING_BLOCK_START_PIXELS}px 24px ${PADDING_BLOCK_END_PIXELS}px;
          background-color: var(--color-surface);
        `,
      )}
    >
      <ul
        className={css`
          display: flex;
          gap: 80px;
          align-items: end;
          justify-content: center;
          padding: 0;
          margin: 0;
          list-style: none;
        `}
      >
        <li>
          <Link to="/recent" className={tabStyles}>
            <TabRecentIcon />
            <span className={textStyles.label}>Recent</span>
          </Link>
        </li>
        <li>
          <ActionLink to="/recent/add" state={{ isOpenedFromRecents: true }} className={tabStyles}>
            <TabAddIcon />
            <span className={textStyles.label}>Add</span>
          </ActionLink>
        </li>
      </ul>
    </nav>
  );
}

/** A router link that never reports itself as the current page, for tabs that perform an action. */
const ActionLink = createLink(function ActionAnchor({
  "aria-current": _ariaCurrent,
  children,
  ...delegated
}: React.ComponentProps<"a">): React.JSX.Element {
  return <a {...delegated}>{children}</a>;
});

const tabStyles = composeClassnames(
  pressableOverlay,
  css`
    display: grid;
    gap: 10px;
    justify-items: center;
    min-width: 44px;
    padding: ${TAB_PADDING_PIXELS}px;

    color: var(--color-ink-40);
    text-decoration: none;
    border-radius: var(--border-radius-sm);

    &[aria-current="page"] {
      color: var(--color-ink);
    }
  `,
);
