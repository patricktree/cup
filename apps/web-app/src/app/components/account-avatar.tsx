import { css } from "@linaria/core";
import type { Session } from "@supabase/supabase-js";
import { Link } from "@tanstack/react-router";
import { UserRound } from "lucide-react";
import React from "react";

import { toAvatarInitials } from "#src/app/avatar-initials.js";
import { AvatarRingIcon } from "#src/app/design-system/icons.js";
import { pressableOverlay } from "#src/app/design-system/interaction-states.js";
import { textStyles } from "#src/app/design-system/text-styles.js";
import { interTypefaceScope } from "#src/app/global-styles.js";
import { composeClassnames } from "#src/app/utils.js";

/** The drawn ring's stroke, so the fallback glyph's lines match it. */
const RING_STROKE_WIDTH = 4;

/**
 * Link to the account dialog showing the account holder's initials in the drawn ring, or a person
 * glyph when the session carries no usable name. Cup stores no name: Supabase fills `name` (and the
 * deprecated `full_name`) from the identity provider.
 */
export function AccountAvatar({
  userMetadata,
}: {
  userMetadata: Session["user"]["user_metadata"] | undefined;
}): React.JSX.Element {
  const initials = toAvatarInitials(userMetadata?.["name"] ?? userMetadata?.["full_name"]);

  return (
    <Link
      {...interTypefaceScope}
      to="/recent/account"
      state={{ isRecentsDialogOpenedInApp: true }}
      // the initials are decoration; the link says where it goes
      aria-label="Account"
      className={composeClassnames(
        pressableOverlay,
        css`
          display: inline-grid;
          grid-template-areas: "avatar";
          place-items: center;
          color: var(--color-ink);
          text-decoration: none;
          border-radius: var(--border-radius-full);

          & > * {
            grid-area: avatar;
          }
        `,
      )}
    >
      <AvatarRingIcon />
      {initials === undefined ? (
        <UserRound
          aria-hidden="true"
          size={24}
          strokeWidth={RING_STROKE_WIDTH}
          absoluteStrokeWidth
        />
      ) : (
        <span
          className={composeClassnames(
            textStyles.h2,
            css`
              /* the drawn initials are lowercase; CSS applies the language's case mapping */
              text-transform: lowercase;
            `,
          )}
        >
          {initials}
        </span>
      )}
    </Link>
  );
}
