import { css } from "@linaria/core";
import React from "react";

type DSButtonGroupProps = {
  children: React.ReactNode;
};

export const DSButtonGroup: React.FC<DSButtonGroupProps> = ({ children }) => {
  return (
    <div
      className={css`
        display: grid;
        gap: calc(1 * var(--spacing-base));
      `}
    >
      {children}
    </div>
  );
};
