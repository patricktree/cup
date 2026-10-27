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

const SIGN_IN_LABELS: Record<SignInMethod, string> = {
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
      buttonGroupChildren={
        <SignInButtons
          signInMethods={signInMethods}
          pendingMethod={pendingMethod}
          onSignIn={onSignIn}
          refs={{ firstButton: signInButton }}
        />
      }
      errorMessage={errorMessage}
    />
  );
}

/** One button per sign-in method, all disabled while a sign-in is in progress. */
export function SignInButtons({
  signInMethods,
  pendingMethod,
  onSignIn,
  refs,
}: Pick<SignInDialogProps, "signInMethods" | "pendingMethod" | "onSignIn"> & {
  refs?: { firstButton?: React.Ref<HTMLButtonElement> | undefined };
}): React.JSX.Element {
  return (
    <>
      {signInMethods.map((method, index) => (
        <DSButton
          key={method}
          ref={index === 0 ? refs?.firstButton : undefined}
          variant="contained"
          disabled={pendingMethod !== undefined}
          onClick={() => onSignIn(method)}
        >
          {pendingMethod === method ? "Signing in…" : SIGN_IN_LABELS[method]}
        </DSButton>
      ))}
    </>
  );
}
