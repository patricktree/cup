import { Button as BaseUIButton } from "@base-ui/react/button";
import { css } from "@linaria/core";
import React from "react";

import { pressableOverlay } from "#src/app/design-system/interaction-states.js";
import { composeClassnames } from "#src/app/utils.js";

type DSIconButtonProps = Omit<React.ComponentProps<"button">, "aria-label" | "children"> & {
  /** Accessible name; the icon itself is decorative. */
  label: string;
  /** One of the drawn icons in `icons.tsx`, shown at its drawn size. */
  icon: React.ReactNode;
};

/**
 * Icon-only button of the redesigned screens: no border or padding, a hit area of at least 44 px,
 * and the icon at 24 % ink while disabled.
 */
export function DSIconButton({
  label,
  icon,
  className,
  ...delegated
}: DSIconButtonProps): React.JSX.Element {
  return (
    <BaseUIButton
      aria-label={label}
      className={composeClassnames(iconButtonStyles, className)}
      {...delegated}
    >
      {icon}
    </BaseUIButton>
  );
}

/** Also for links that look like an icon button, such as the detail view's back chevron. */
export const iconButtonStyles = composeClassnames(
  pressableOverlay,
  css`
    display: inline-grid;
    place-items: center;
    min-width: 44px;
    min-height: 44px;
    padding: 0;

    color: var(--color-ink);
    cursor: pointer;
    background: none;
    border: 0;
    border-radius: var(--border-radius-full);

    &:disabled {
      color: var(--color-ink-24);
      cursor: not-allowed;
    }
  `,
);
