import { css } from "@linaria/core";
import { createLink, Link } from "@tanstack/react-router";
import React from "react";

import { fadeFooter } from "#src/app/components/fade-footer.js";
import { TabAddIcon, TabRecentIcon } from "#src/app/design-system/icons.js";
import { pressableOverlay } from "#src/app/design-system/interaction-states.js";
import { textStyles } from "#src/app/design-system/text-styles.js";
import { interTypefaceScope } from "#src/app/global-styles.js";
import { composeClassnames } from "#src/app/utils.js";

/** Height of the drawn fade, from its transparent top to the bottom of the screen. */
const FADE_HEIGHT_PIXELS = 194;
const PADDING_BLOCK_PIXELS = 32;
const TAB_PADDING_PIXELS = 5;
/** The bar's own row: its padding around the tabs' padding, 24 px icon, 4 px gap and caption. */
const BAR_HEIGHT_PIXELS = 2 * PADDING_BLOCK_PIXELS + 2 * TAB_PADDING_PIXELS + 24 + 4 + 24;

/** Bottom padding of the page above the tab bar, so its last content ends where the fade begins. */
export const TAB_BAR_CLEARANCE = `${FADE_HEIGHT_PIXELS - BAR_HEIGHT_PIXELS}px`;

/** Distance from the top of the tab bar down to its tab icons. */
export const TAB_BAR_ICONS_OFFSET_PIXELS = PADDING_BLOCK_PIXELS + TAB_PADDING_PIXELS;

/**
 * Tabs of the account shell pages (Recents and the account page), at the bottom of the page on the
 * drawn fade. The tab of the current page is at full ink; Add opens the Add dialog and, being an
 * action, never shows as current.
 */
export function AccountTabBar(): React.JSX.Element {
  return (
    <nav
      {...interTypefaceScope}
      aria-label="Tabs"
      className={composeClassnames(
        fadeFooter,
        css`
          --fade-height: ${FADE_HEIGHT_PIXELS}px;
          --fade-background: var(--background-fade-tab-bar);

          grid-area: shell-tab-bar;
          min-height: ${BAR_HEIGHT_PIXELS}px;
          padding: ${PADDING_BLOCK_PIXELS}px 24px;
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
            <span className={captionStyles}>Recent</span>
          </Link>
        </li>
        <li>
          <ActionLink
            to="/recent/add"
            state={{ isAddDialogOpenedInApp: true }}
            className={tabStyles}
          >
            <TabAddIcon />
            <span className={captionStyles}>Add</span>
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
    gap: 4px;
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

const captionStyles = composeClassnames(
  textStyles.label,
  css`
    padding-block: 6px;
  `,
);
