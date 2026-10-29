import { Button as BaseUIButton } from "@base-ui/react/button";
import { css } from "@linaria/core";
import React from "react";

import { pressableOverlay } from "#src/app/design-system/interaction-states.js";
import { textStyles } from "#src/app/design-system/text-styles.js";
import type { MapPropsToRequiredDataAttributeProps } from "#src/app/styling.utils.js";
import { composeClassnames } from "#src/app/utils.js";

type DSButtonProps = React.ComponentProps<"button"> & DSButtonCustomProps & { isPending?: boolean };

type DSButtonCustomProps = {
  variant?: "outlined" | "contained" | "text";
};

type DSButtonDataAttributes = MapPropsToRequiredDataAttributeProps<DSButtonCustomProps>;

/**
 * Shared application button: a pill in Paragraph text, filled with ink (contained), outlined, or
 * without a surface (text). The outlined and text variants take the surrounding text color. A
 * disabled button fades; a pending one stays opaque behind its spinner.
 */
export const DSButton: React.FC<DSButtonProps> = ({
  variant = "outlined",
  isPending = false,
  disabled,
  children,
  className,
  style,
  ...delegated
}) => {
  const dataAttributes: DSButtonDataAttributes = { "data-variant": variant };

  return (
    <BaseUIButton
      className={composeClassnames(
        textStyles.paragraph,
        pressableOverlay,
        css`
          display: inline-flex;
          gap: var(--spacing-base);
          align-items: center;
          justify-content: center;
          min-height: 48px;
          padding-block: var(--spacing-base);
          padding-inline: calc(3 * var(--spacing-base));

          color: inherit;
          background-color: transparent;
          border: 0;
          border-radius: var(--border-radius-full);

          &:hover {
            cursor: pointer;
          }

          &:disabled {
            cursor: not-allowed;
          }

          /* aria-busy is set from isPending below; a pending button keeps its spinner legible */
          &:disabled:not([aria-busy="true"]) {
            opacity: 0.4;
          }

          &[data-variant="outlined"] {
            border: 1px solid currentcolor;
          }

          &[data-variant="contained"] {
            color: var(--color-page);
            background-color: var(--color-ink);

            /* the ink overlay of pressableOverlay would not show on the ink fill */
            &::after {
              background-color: rgb(255 255 255 / 16%);
            }
          }
        `,
        className,
      )}
      style={style ?? {}}
      {...dataAttributes}
      {...delegated}
      aria-busy={isPending || undefined}
      disabled={disabled || isPending}
    >
      {isPending && (
        <span
          aria-hidden="true"
          className={css`
            width: 1em;
            height: 1em;
            border: 2px solid currentcolor;
            border-right-color: transparent;
            border-radius: 50%;
            animation: button-spinner-rotate 0.8s linear infinite;

            @keyframes button-spinner-rotate {
              to {
                transform: rotate(360deg);
              }
            }

            @media (prefers-reduced-motion: reduce) {
              animation: none;
            }
          `}
        />
      )}
      {children}
    </BaseUIButton>
  );
};
