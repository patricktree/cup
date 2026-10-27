import { Menu } from "@base-ui/react/menu";
import { css } from "@linaria/core";
import { Link } from "@tanstack/react-router";
import React from "react";

import { iconButtonStyles } from "#src/app/design-system/icon-button.js";
import { BackChevronIcon, MoreIcon } from "#src/app/design-system/icons.js";
import { pressableOverlay } from "#src/app/design-system/interaction-states.js";
import { singleLine, textStyles } from "#src/app/design-system/text-styles.js";
import { interTypefaceScope } from "#src/app/global-styles.js";
import { composeClassnames } from "#src/app/utils.js";

/** Only accounts have Recents; trial listeners return to the start. */
export type DetailBackTarget = "/recent" | "/";

type DetailTopBarProps = {
  backTo: DetailBackTarget;
  /** Shown in the middle once the page's own title has scrolled out of view. */
  compactTitle: { title: string; host: string } | undefined;
  /** Absent until the audiobook has loaded. */
  menu: DetailMenuProps | undefined;
};

type DetailMenuProps = {
  originalUrl: string;
  /** Absent when the audiobook offers no retry. */
  retry: { isPending: boolean; start: () => void } | undefined;
};

/** The detail view's top bar: back, the compact title once scrolled, and the "…" menu. */
export function DetailTopBar({ backTo, compactTitle, menu }: DetailTopBarProps): React.JSX.Element {
  return (
    <div
      {...interTypefaceScope}
      className={css`
        display: grid;
        grid-template-areas: "back title menu";
        grid-template-columns: max-content minmax(0, 1fr) max-content;
        gap: var(--spacing-base);
        align-items: center;
        width: 100%;
        min-height: 40px;
      `}
    >
      <Link
        to={backTo}
        aria-label="Back"
        className={composeClassnames(
          iconButtonStyles,
          css`
            grid-area: back;
          `,
        )}
      >
        <BackChevronIcon />
      </Link>

      {compactTitle ? (
        <div
          className={css`
            display: grid;
            grid-area: title;
            gap: 4px;
            justify-items: center;
            text-align: center;

            & > p {
              max-width: 100%;
            }
          `}
        >
          <p
            className={composeClassnames(
              textStyles.tagline,
              singleLine,
              css`
                font-weight: var(--font-weight-inter-figma-medium);
              `,
            )}
          >
            {compactTitle.title}
          </p>
          <p
            className={composeClassnames(
              textStyles.tagline,
              singleLine,
              css`
                color: var(--color-ink-40);
              `,
            )}
          >
            {compactTitle.host}
          </p>
        </div>
      ) : null}

      {menu ? <DetailMenu {...menu} /> : null}
    </div>
  );
}

function DetailMenu({ originalUrl, retry }: DetailMenuProps) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="More"
        className={composeClassnames(
          iconButtonStyles,
          css`
            grid-area: menu;
          `,
        )}
      >
        <MoreIcon />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4}>
          <Menu.Popup
            {...interTypefaceScope}
            className={css`
              display: grid;
              min-width: 200px;
              padding: var(--spacing-base);
              outline: 0;

              background-color: var(--color-surface);
              border-radius: var(--border-radius-lg);
              box-shadow: var(--shadow-card);
            `}
          >
            <Menu.LinkItem
              href={originalUrl}
              target="_blank"
              rel="noopener noreferrer"
              closeOnClick
              className={menuItemStyles}
            >
              Open original page
            </Menu.LinkItem>
            {retry ? (
              <Menu.Item
                disabled={retry.isPending}
                onClick={retry.start}
                className={menuItemStyles}
              >
                Retry
              </Menu.Item>
            ) : null}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

const menuItemStyles = composeClassnames(
  textStyles.h5,
  pressableOverlay,
  css`
    display: block;
    padding-block: var(--spacing-base);
    padding-inline: var(--spacing-gutter);

    color: var(--color-ink);
    text-decoration: none;
    cursor: pointer;
    user-select: none;
    border-radius: calc(var(--border-radius-lg) - var(--spacing-base));

    /* Base UI highlights the item under the pointer or keyboard focus */
    &[data-highlighted] {
      background-color: var(--color-ink-8);
    }

    &[data-disabled] {
      color: var(--color-ink-24);
      cursor: not-allowed;
    }
  `,
);
