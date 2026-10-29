import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";
import React from "react";

import { AccountLoadError, AccountLoading } from "#src/app/components/account-load-states.js";
import { AccountRecoveryFrame } from "#src/app/components/account-recovery-frame.js";
import { AccountSettings } from "#src/app/components/account-settings.js";
import { SignInButtons } from "#src/app/components/sign-in-dialog.js";
import { settleAccountSession } from "#src/auth/account-session.js";
import { useAccountSession, useSignInMethods } from "#src/auth/hooks.js";
import { accountQuery, useSignInMutation } from "#src/data-fetching/account.js";

/**
 * Restores an account whose deletion is scheduled; the scheduled-deletion email links here.
 * Scheduling deletion signs the listener out, so this page signs them in itself, outside Recents
 * and its dialogs, which a signed-out listener cannot reach. Confirming signs in with Google again,
 * which returns here.
 */
export const Route = createFileRoute("/account-recovery")({
  component: AccountRecoveryPage,
  beforeLoad: async () => {
    const session = await settleAccountSession();
    return { subject: session?.user.id };
  },
  loader: async ({ context }) => {
    if (context.subject !== undefined) {
      await context.queryClient.query({ ...accountQuery(context.subject), staleTime: "static" });
    }
  },
  pendingComponent: () => (
    <AccountRecoveryFrame>
      <AccountLoading />
    </AccountRecoveryFrame>
  ),
  errorComponent: ({ error }: ErrorComponentProps) => (
    <AccountRecoveryFrame>
      <AccountLoadError error={error} />
    </AccountRecoveryFrame>
  ),
});

function AccountRecoveryPage(): React.ReactNode {
  const session = useAccountSession();
  const signIn = useSignInMutation();
  const signInMethods = useSignInMethods();

  return (
    <AccountRecoveryFrame>
      {session ? (
        <AccountSettings
          key={session.user.id}
          subject={session.user.id}
          email={session.user.email}
          purpose="recovery"
        />
      ) : (
        <section aria-label="Sign in">
          <p>Sign in with the account whose deletion is scheduled.</p>
          <SignInButtons
            signInMethods={signInMethods}
            pendingMethod={signIn.isPending ? signIn.variables : undefined}
            onSignIn={(method) => signIn.mutate(method)}
          />
          {signIn.error && <p role="alert">{signIn.error.message}</p>}
        </section>
      )}
    </AccountRecoveryFrame>
  );
}
