import { Dialog, type DialogPopupProps, type DialogRootProps } from "@base-ui/react";
import { css } from "@linaria/core";
import React from "react";

import { DSIconButton } from "#src/app/design-system/icon-button.js";
import { CloseIcon } from "#src/app/design-system/icons.js";
import { textStyles } from "#src/app/design-system/text-styles.js";
import { interTypefaceScope } from "#src/app/global-styles.js";

export type DSSheetProps = {
  open: DialogRootProps["open"];
  onOpenChange: DialogRootProps["onOpenChange"];
  initialFocus: DialogPopupProps["initialFocus"];
  finalFocus: DialogPopupProps["finalFocus"];
  title: React.ReactNode;
  /** Content below the title row, such as a form. */
  children: React.ReactNode;
  closeButtonDisabled: boolean;
};

/**
 * A dialog that rises from the bottom edge, drawn for the Add a Track sheet
 * (https://www.figma.com/design/Mud3jhH7Lliuv0jIbCS63R/cup?node-id=485-12270): a grabber, the title
 * with a close button beside it, then the content. The grabber only marks the sheet; it does not
 * drag. Escape and a press outside close it too.
 */
export const DSSheet: React.FC<DSSheetProps> = ({
  open,
  onOpenChange,
  initialFocus,
  finalFocus,
  title,
  children,
  closeButtonDisabled,
}) => {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
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
            inset-inline: 0;
            bottom: 0;

            /* the app column, less the gutter on each side */
            width: calc(min(100%, var(--app-max-width)) - 2 * var(--spacing-gutter));
            /*
             * the design shows 313 px of the sheet above the bottom edge; a minimum instead of padding
             * below the content, so a short viewport or an open keyboard gives up only blank space
             */
            min-height: min(313px, calc(100dvh - 2 * var(--spacing-gutter)));
            max-height: calc(100dvh - 2 * var(--spacing-gutter));
            padding-block: calc(1.5 * var(--spacing-base))
              calc(var(--spacing-gutter) + env(safe-area-inset-bottom, 0px));
            padding-inline: var(--spacing-gutter);
            margin-inline: auto;

            overflow: auto;
            background: var(--color-surface);
            border-start-start-radius: var(--border-radius-lg);
            border-start-end-radius: var(--border-radius-lg);
            box-shadow: var(--shadow-card);
          `}
        >
          <div
            aria-hidden="true"
            className={css`
              position: absolute;
              top: 4px;
              left: 50%;
              width: 41px;
              height: 4px;
              background: var(--color-ink-40);
              border-radius: var(--border-radius-full);
              transform: translateX(-50%);
            `}
          />
          <div
            className={css`
              display: flex;
              gap: var(--spacing-gutter);
              align-items: center;
              justify-content: space-between;
              min-height: 32px;
            `}
          >
            <Dialog.Title className={textStyles.h2}>{title}</Dialog.Title>
            <Dialog.Close
              disabled={closeButtonDisabled}
              render={
                <DSIconButton
                  label="Close"
                  icon={<CloseIcon />}
                  className={css`
                    /* the 44 px hit area overhangs the drawn 32 px box, so the row keeps its height */
                    margin: -6px;
                    color: var(--color-ink-40);
                  `}
                />
              }
            />
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
