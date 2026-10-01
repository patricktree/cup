import { Button as BaseUIButton } from "@base-ui/react/button";
import { css } from "@linaria/core";
import React from "react";

import type { MapPropsToRequiredDataAttributeProps } from "#src/app/styling.utils.js";
import { composeClassnames } from "#src/app/utils.js";

type DSButtonProps = React.ComponentProps<"button"> & DSButtonCustomProps & { isPending?: boolean };

type DSButtonCustomProps = {
  variant?: "outlined" | "contained" | "text";
};

type DSButtonDataAttributes = MapPropsToRequiredDataAttributeProps<DSButtonCustomProps>;

/** Shared application button with the supported visual variants. */
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
        css`
          display: inline-flex;
          gap: var(--spacing-base);
          align-items: center;
          justify-content: center;
          padding-block: calc(1 * var(--spacing-base));
          padding-inline: calc(1.5 * var(--spacing-base));

          font-size: var(--font-size-sm);
          font-weight: var(--font-weight-inter-figma-medium);
          color: inherit;
          background-color: transparent;
          border: 0;
          border-radius: var(--border-radius-sm);

          &:hover {
            cursor: pointer;
          }

          &:disabled {
            cursor: not-allowed;
          }

          &[data-variant="outlined"] {
            background-color: var(--color-bg);
            border: 1px solid currentcolor;
          }

          &[data-variant="contained"] {
            color: var(--color-input-bg);
            background-color: var(--color-primary);
          }
        `,
        className,
      )}
      style={style ?? {}}
      {...dataAttributes}
      {...delegated}
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
