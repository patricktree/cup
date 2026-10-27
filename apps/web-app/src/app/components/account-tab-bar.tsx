import { css } from "@linaria/core";
import { createLink, Link } from "@tanstack/react-router";
import React from "react";

import { TabAddIcon, TabRecentIcon } from "#src/app/design-system/icons.js";
import { pressableOverlay } from "#src/app/design-system/interaction-states.js";
import { textStyles } from "#src/app/design-system/text-styles.js";
import { interTypefaceScope } from "#src/app/global-styles.js";
import { composeClassnames } from "#src/app/utils.js";

/**
 * Height of the drawn fade; the bar's own row is shorter, so the fade reaches over the content
 * above.
 */
const FADE_HEIGHT = "194px";

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
      className={css`
        /* containing block for the fade below */
        position: relative;

        /* above shell <main>, whose end scrolls under the fade */
        z-index: 1;
        grid-area: shell-tab-bar;
        padding: 32px 24px;

        &::before {
          position: absolute;
          inset-inline: 0;
          bottom: 0;
          z-index: -1;
          height: ${FADE_HEIGHT};

          /* let clicks reach the content fading underneath */
          pointer-events: none;
          content: "";
          background: var(--background-fade-tab-bar);
        }
      `}
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
    padding: 5px;

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
