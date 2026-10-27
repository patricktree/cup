import { Toast } from "@base-ui/react/toast";
import { css } from "@linaria/core";
import { X } from "lucide-react";
import React from "react";

import { DSButton } from "#src/app/design-system/button.js";

/** Renders the toasts added through the surrounding `Toast.Provider`. */
export const DSToastViewport: React.FC = () => {
  const { toasts } = Toast.useToastManager();

  return (
    <Toast.Portal>
      <Toast.Viewport
        className={css`
          position: fixed;
          /* the player controls and the tab bar occupy the bottom of the screen */
          top: var(--app-padding-block);
          left: 50%;
          /* above dialogs, whose portals mount after this one */
          z-index: 1;

          display: grid;
          gap: var(--spacing-base);
          width: min(480px, calc(100vw - 2 * var(--app-padding-inline)));

          transform: translateX(-50%);
        `}
      >
        {toasts.map((toast) => (
          <Toast.Root
            key={toast.id}
            toast={toast}
            className={css`
              display: flex;
              gap: var(--spacing-base);
              align-items: flex-start;
              padding: calc(1.5 * var(--spacing-base));

              font-size: var(--font-size-sm);
              color: var(--color-bg);
              background: var(--color-fg);
              border-inline-start: 4px solid var(--color-error);
              border-radius: var(--border-radius-sm);

              &[data-limited] {
                display: none;
              }
            `}
          >
            <Toast.Content
              className={css`
                display: grid;
                flex: 1;
                gap: calc(0.5 * var(--spacing-base));
              `}
            >
              <Toast.Title
                className={css`
                  font-weight: var(--font-weight-inter-figma-medium);
                `}
              />
              <Toast.Description />
            </Toast.Content>
            <Toast.Close render={<DSButton variant="text" aria-label="Dismiss" />}>
              <X size={16} />
            </Toast.Close>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
};
