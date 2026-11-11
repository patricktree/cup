import { Drawer } from "@base-ui/react";
import { css } from "@linaria/core";
import React from "react";

import { DSIconButton } from "#src/app/design-system/icon-button.js";
import { CloseIcon } from "#src/app/design-system/icons.js";
import { textStyles } from "#src/app/design-system/text-styles.js";
import { interTypefaceScope } from "#src/app/global-styles.js";

export type DSSheetProps = {
  open: Drawer.Root.Props["open"];
  onOpenChange: Drawer.Root.Props["onOpenChange"];
  /** Called once the sheet has finished sliding away after closing. */
  onClosed: () => void;
  initialFocus: Drawer.Popup.Props["initialFocus"];
  finalFocus: Drawer.Popup.Props["finalFocus"];
  title: React.ReactNode;
  /** Content below the title row, such as a form. */
  children: React.ReactNode;
  closeButtonDisabled: boolean;
};

const SLIDE_DURATION = "450ms";
const SLIDE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
/**
 * A fast pull hands its speed on: Base UI sets the swipe strength between 0.1 for a flick and 1 for
 * a slow pull or any other close, which slides away as long as opening slid in.
 */
const CLOSE_DURATION = `calc(var(--drawer-swipe-strength) * ${SLIDE_DURATION})`;
/** Below the bottom edge, with room for the shadow that rises above the sheet. */
const OFFSCREEN_TRANSFORM = "translateY(calc(100% + 24px))";

/**
 * A dialog that rises from the bottom edge, drawn for the Add a Track sheet
 * (https://www.figma.com/design/Mud3jhH7Lliuv0jIbCS63R/cup?node-id=485-12270): a grabber, the title
 * with a close button beside it, then the content. It slides up when it opens and back down when it
 * closes. Pulling it down closes it: by touch anywhere on the sheet, by mouse anywhere outside the
 * content (the grabber, the title row and the blank space around them), so text in the content
 * stays selectable. Escape and a press outside close it too. Base UI marks no starting style on a
 * sheet mounted open, so `@starting-style` slides that one in as well.
 */
export const DSSheet: React.FC<DSSheetProps> = ({
  open,
  onOpenChange,
  onClosed,
  initialFocus,
  finalFocus,
  title,
  children,
  closeButtonDisabled,
}) => {
  return (
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) {
          onClosed();
        }
      }}
    >
      <Drawer.Portal
        className={css`
          isolation: isolate;
        `}
      >
        <Drawer.Backdrop
          className={css`
            position: fixed;
            inset: 0;
            background: var(--background-dialog-backdrop);
            /* the backdrop fades as the sheet is pulled down */
            opacity: calc(1 - var(--drawer-swipe-progress));

            &[data-starting-style],
            &[data-ending-style],
            &[data-closed] {
              opacity: 0;
            }

            @starting-style {
              opacity: 0;
            }

            @media (prefers-reduced-motion: no-preference) {
              transition: opacity ${SLIDE_DURATION} ${SLIDE_EASING};

              &[data-swiping] {
                transition-duration: 0ms;
              }

              &[data-ending-style],
              &[data-closed] {
                transition-duration: ${CLOSE_DURATION};
              }
            }
          `}
        />
        <Drawer.Viewport
          className={css`
            position: fixed;
            inset: 0;
            display: flex;
            align-items: flex-end;
            justify-content: center;
          `}
        >
          <Drawer.Popup
            {...interTypefaceScope}
            initialFocus={initialFocus}
            finalFocus={finalFocus}
            className={css`
              /* the grabber is placed against the sheet */
              position: relative;

              /* the app column, less the gutter on each side */
              width: calc(min(100%, var(--app-max-width)) - 2 * var(--spacing-gutter));
              /*
               * the design shows 313 px of the sheet above the bottom edge; a minimum instead of
               * padding below the content, so a short viewport or an open keyboard gives up only
               * blank space
               */
              min-height: min(313px, calc(100dvh - 2 * var(--spacing-gutter)));
              max-height: calc(100dvh - 2 * var(--spacing-gutter));
              padding-block: calc(1.5 * var(--spacing-base))
                calc(var(--spacing-gutter) + env(safe-area-inset-bottom, 0px));
              padding-inline: var(--spacing-gutter);

              overflow: auto;
              overscroll-behavior: contain;
              outline: none;
              background: var(--color-surface);
              border-start-start-radius: var(--border-radius-lg);
              border-start-end-radius: var(--border-radius-lg);
              box-shadow: var(--shadow-card);
              transform: translateY(var(--drawer-swipe-movement-y));

              &[data-swiping] {
                user-select: none;
              }

              &[data-starting-style],
              &[data-ending-style],
              &[data-closed] {
                transform: ${OFFSCREEN_TRANSFORM};
              }

              @starting-style {
                transform: ${OFFSCREEN_TRANSFORM};
              }

              @media (prefers-reduced-motion: no-preference) {
                transition: transform ${SLIDE_DURATION} ${SLIDE_EASING};

                /*
                 * still once closed: Base UI drops the ending style on the last frame, and WebKit
                 * restarts a transition whose duration changes, so the sheet flashed back for a frame
                 */
                &[data-ending-style],
                &[data-closed] {
                  transition-duration: ${CLOSE_DURATION};
                }
              }
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
              <Drawer.Title className={textStyles.h2}>{title}</Drawer.Title>
              <Drawer.Close
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
            <Drawer.Content>{children}</Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
};
