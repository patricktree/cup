import React from "react";

import { DSButton } from "#src/app/design-system/button.js";
import { DSDialog, type DSDialogProps } from "#src/app/design-system/dialog.js";

type SignInDialogProps = Pick<
  DSDialogProps,
  "open" | "onOpenChange" | "finalFocus" | "errorMessage"
> & {
  isPending: boolean;
  onSignIn: () => void;
};

export function SignInDialog({
  open,
  onOpenChange,
  finalFocus,
  errorMessage,
  isPending,
  onSignIn,
}: SignInDialogProps): React.ReactNode {
  const signInButton = React.useRef<HTMLButtonElement>(null);

  return (
    <DSDialog
      open={open}
      onOpenChange={onOpenChange}
      initialFocus={signInButton}
      finalFocus={finalFocus}
      title={<>Sign in</>}
      description={
        <>
          Sign in to listen. <strong>New accounts get 30 free minutes.</strong>
        </>
      }
      cancelButtonText={<>Cancel</>}
      cancelButtonDisabled={isPending}
      buttonGroupChildren={
        <DSButton ref={signInButton} variant="contained" disabled={isPending} onClick={onSignIn}>
          {isPending ? "Signing in…" : "Continue with Google"}
        </DSButton>
      }
      errorMessage={errorMessage}
    />
  );
}
