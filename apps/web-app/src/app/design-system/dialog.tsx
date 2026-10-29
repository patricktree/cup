import { AlertDialog, Dialog, type DialogPopupProps, type DialogRootProps } from "@base-ui/react";
import { css } from "@linaria/core";
import React from "react";

import { DSButtonGroup } from "#src/app/design-system/button-group.js";
import { DSButton } from "#src/app/design-system/button.js";
import { textStyles } from "#src/app/design-system/text-styles.js";
import { interTypefaceScope } from "#src/app/global-styles.js";

export type DSDialogProps = {
  /**
   * `"alertdialog"` interrupts to confirm an action, such as a destructive one: it is announced as
   * an alert dialog and a click outside does not close it.
   */
  role?: "dialog" | "alertdialog";
  open: DialogRootProps["open"];
  onOpenChange: DialogRootProps["onOpenChange"];
  initialFocus: DialogPopupProps["initialFocus"];
  finalFocus: DialogPopupProps["finalFocus"];
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Content between the description and the buttons, such as a form. */
  children?: React.ReactNode;
  cancelButtonText: React.ReactNode;
  cancelButtonDisabled: boolean;
  /** Lets `initialFocus` start on Cancel, the safe choice of a destructive confirmation. */
  cancelButtonRef?: React.Ref<HTMLButtonElement>;
  buttonGroupChildren?: React.ReactNode;
  errorMessage?: React.ReactNode;
};

export const DSDialog: React.FC<DSDialogProps> = ({
  role = "dialog",
  open,
  onOpenChange,
  initialFocus,
  finalFocus,
  title,
  description,
  children,
  cancelButtonText,
  cancelButtonDisabled,
  cancelButtonRef,
  buttonGroupChildren,
  errorMessage,
}) => {
  // Both roots share every other part.
  const Root = role === "alertdialog" ? AlertDialog.Root : Dialog.Root;

  return (
    <Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal
        className={css`
          isolation: isolate;
        `}
      >
        <Dialog.Backdrop
          className={css`
            position: fixed;
            inset: 0;
            background: var(--background-dialog-backdrop);
          `}
        />
        <Dialog.Popup
          {...interTypefaceScope}
          initialFocus={initialFocus}
          finalFocus={finalFocus}
          className={css`
            position: fixed;
            top: 50%;
            left: 50%;

            display: grid;
            gap: calc(2 * var(--spacing-base));
            min-width: min(400px, calc(100vw - 2 * var(--app-padding-inline)));
            padding-block: calc(3 * var(--spacing-base));
            padding-inline: calc(3 * var(--spacing-base));

            overflow: auto;
            background: var(--color-surface);
            border-radius: var(--border-radius-lg);
            transform: translate(-50%, -50%);
          `}
        >
          <Dialog.Title className={textStyles.h4}>{title}</Dialog.Title>
          {description && <Dialog.Description>{description}</Dialog.Description>}
          {children}

          <DSButtonGroup>
            {buttonGroupChildren}
            <Dialog.Close
              ref={cancelButtonRef}
              render={<DSButton disabled={cancelButtonDisabled} />}
            >
              {cancelButtonText}
            </Dialog.Close>
          </DSButtonGroup>

          {errorMessage && <p role="alert">{errorMessage}</p>}
        </Dialog.Popup>
      </Dialog.Portal>
    </Root>
  );
};
