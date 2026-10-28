import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { Temporal } from "temporal-polyfill";

import { AccountQueryBoundary } from "#src/app/components/account-query-boundary.js";
import { SignInButtons } from "#src/app/components/sign-in-dialog.js";
import { DSButton } from "#src/app/design-system/button.js";
import { DSDialog } from "#src/app/design-system/dialog.js";
import { useCloseRecentsDialog } from "#src/app/use-close-recents-dialog.js";
import { useAccountSession, useAccountAuthState, useSignInMethods } from "#src/auth/hooks.js";
import {
  useAccountConfirmation,
  useIsAccountConfirmationPending,
} from "#src/data-fetching/account-confirmation.js";
import { accountQuery, useSignInMutation } from "#src/data-fetching/account.js";

/**
 * The account dialog over Recents. Unlike the Add dialog, no route mask hides its URL: confirming a
 * deletion or recovery signs in with Google again, and that sign-in returns to the URL bar's path,
 * where the dialog has to open again to show the confirmation step. A signed-out listener, such as
 * one following the scheduled-deletion email, signs in here and returns to the dialog the same
 * way.
 */
export const Route = createFileRoute("/_shell/recent/account")({
  component: AccountDialog,
});

function AccountDialog(): React.ReactNode {
  const session = useAccountSession();
  const authState = useAccountAuthState();
  const close = useCloseRecentsDialog(Route.id);
  const isConfirmationPending = useIsAccountConfirmationPending();
  const signIn = useSignInMutation();
  const signInMethods = useSignInMethods();
  // Leaving while a step runs would lose the return from Google, which comes back to this URL.
  const isCloseBlocked = isConfirmationPending || signIn.isPending;

  return (
    <DSDialog
      open
      onOpenChange={(open) => {
        if (!open && !isCloseBlocked) {
          close();
        }
      }}
      initialFocus={undefined}
      finalFocus={undefined}
      title={<>Account settings</>}
      cancelButtonText={<>Close</>}
      cancelButtonDisabled={isCloseBlocked}
    >
      {authState.status === "loading" ? (
        <output>Loading account…</output>
      ) : authState.status === "error" ? (
        <p role="alert">{authState.error.message}</p>
      ) : session ? (
        <AccountQueryBoundary key={session.user.id}>
          <AccountSettings subject={session.user.id} email={session.user.email} />
        </AccountQueryBoundary>
      ) : (
        <section aria-label="Sign in">
          <p>Sign in to manage or restore your account.</p>
          <SignInButtons
            signInMethods={signInMethods}
            pendingMethod={signIn.isPending ? signIn.variables : undefined}
            onSignIn={(method) => signIn.mutate(method)}
          />
          {signIn.error && <p role="alert">{signIn.error.message}</p>}
        </section>
      )}
    </DSDialog>
  );
}

function AccountSettings({
  subject,
  email,
}: {
  subject: string;
  email: string | undefined;
}): React.ReactNode {
  const account = useSuspenseQuery(accountQuery(subject));
  const confirmation = useAccountConfirmation(subject);
  const { challenge, isPending: pending, error, result, begin, confirm, cancel } = confirmation;
  const data = account.data;
  if (account.error && !account.isFetching) {
    throw account.error;
  }
  return (
    <>
      <p>{email}</p>
      {data.state === "active" ? (
        <section aria-label="Delete account">
          <h3>Delete account</h3>
          <p>
            Access stops immediately. You can restore this account for seven days. After that, your
            account and private conversions are deleted. Original trial conversions stay separate.
          </p>
          <DSButton disabled={pending} onClick={() => begin("delete")}>
            Delete account…
          </DSButton>
        </section>
      ) : (
        <section aria-label="Account recovery">
          <h3>Deletion scheduled</h3>
          <p>Account access is blocked. Signing in alone does not cancel deletion.</p>
          {data.recoveryDeadlineMs !== null && (
            <p>
              Recovery deadline:{" "}
              {Temporal.Instant.fromEpochMilliseconds(data.recoveryDeadlineMs).toLocaleString()}
            </p>
          )}
          <DSButton
            disabled={
              pending ||
              data.state === "deleting" ||
              (data.recoveryDeadlineMs !== null &&
                Temporal.Now.instant().epochMilliseconds >= data.recoveryDeadlineMs)
            }
            onClick={() => begin("restore")}
          >
            Restore account…
          </DSButton>
        </section>
      )}
      {challenge && (
        <section aria-label="Confirm account change">
          <p>
            After signing in again with the same Google account, confirm{" "}
            {challenge.action === "delete" ? "account deletion" : "account recovery"}.
          </p>
          <DSButton disabled={pending || challenge.subject !== subject} onClick={confirm}>
            {challenge.action === "delete" ? "Schedule deletion" : "Confirm recovery"}
          </DSButton>
          <DSButton disabled={pending} onClick={cancel}>
            Cancel
          </DSButton>
        </section>
      )}
      {pending && <output>Working…</output>}
      {error && <p role="alert">{error}</p>}
      {result && <output>{result}</output>}
    </>
  );
}
