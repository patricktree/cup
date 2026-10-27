import React from "react";

import { DSButton } from "#src/app/design-system/button.js";
import { DSDialog, type DSDialogProps } from "#src/app/design-system/dialog.js";
import type { SignInMethod } from "#src/auth/account-session.js";

type SignInDialogProps = Pick<
  DSDialogProps,
  "open" | "onOpenChange" | "finalFocus" | "errorMessage"
> & {
  signInMethods: readonly SignInMethod[];
  /** The method of the sign-in in progress, if any. */
  pendingMethod: SignInMethod | undefined;
  onSignIn: (method: SignInMethod) => void;
};

export const SIGN_IN_LABELS: Record<SignInMethod, string> = {
  google: "Continue with Google",
  "test-account": "Sign in with test account",
};

export function SignInDialog({
  open,
  onOpenChange,
  finalFocus,
  errorMessage,
  signInMethods,
  pendingMethod,
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
      cancelButtonDisabled={pendingMethod !== undefined}
      buttonGroupChildren={signInMethods.map((method, index) => (
        <DSButton
          key={method}
          ref={index === 0 ? signInButton : undefined}
          variant="contained"
          disabled={pendingMethod !== undefined}
          onClick={() => onSignIn(method)}
        >
          {pendingMethod === method ? "Signing in…" : SIGN_IN_LABELS[method]}
        </DSButton>
      ))}
      errorMessage={errorMessage}
    />
  );
}
