import { createFileRoute } from "@tanstack/react-router";
import React from "react";

import { AccountQueryBoundary } from "#src/app/components/account-query-boundary.js";
import { AccountSettings } from "#src/app/components/account-settings.js";
import { DSDialog } from "#src/app/design-system/dialog.js";
import { useMarkSkeletonShown } from "#src/app/pending-prototype/pending-prototype.js";
import { useCloseRecentsDialog } from "#src/app/use-close-recents-dialog.js";
import { useAccountSession, useAccountAuthState } from "#src/auth/hooks.js";
import { accountQuery } from "#src/data-fetching/account.js";
import { useIsAccountConfirmationPending } from "#src/data-fetching/account-confirmation.js";

/**
 * The account dialog over Recents. Unlike the Add dialog, no route mask hides its URL: confirming a
 * deletion or recovery signs in with Google again, and that sign-in returns to the URL bar's path,
 * where the dialog has to open again to show the confirmation step.
 */
export const Route = createFileRoute("/_shell/recent/account")({
  // PROTOTYPE: the decided loading model (#147): an awaited loader and route-owned pending UI
  loader: async ({ context }) => {
    await context.queryClient.query({ ...accountQuery(context.subject), staleTime: "static" });
  },
  pendingComponent: AccountDialogPending,
  component: AccountDialog,
});

function AccountDialogPending(): React.ReactNode {
  useMarkSkeletonShown();
  const close = useCloseRecentsDialog(Route.id);
  return (
    <DSDialog
      open
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
      initialFocus={undefined}
      finalFocus={undefined}
      title={<>Account settings</>}
      cancelButtonText={<>Close</>}
    >
      <output>Loading account…</output>
    </DSDialog>
  );
}

function AccountDialog(): React.ReactNode {
  const session = useAccountSession();
  const authState = useAccountAuthState();
  const close = useCloseRecentsDialog(Route.id);
  // Leaving while a step runs would lose the return from Google, which comes back to this URL.
  const isConfirmationPending = useIsAccountConfirmationPending();

  return (
    <DSDialog
      open
      onOpenChange={(open) => {
        if (!open && !isConfirmationPending) {
          close();
        }
      }}
      initialFocus={undefined}
      finalFocus={undefined}
      title={<>Account settings</>}
      cancelButtonText={<>Close</>}
      cancelButtonDisabled={isConfirmationPending}
    >
      {/* Signed out, Recents behind the dialog redirects home. */}
      {authState.status === "loading" ? (
        <output>Loading account…</output>
      ) : authState.status === "error" ? (
        <p role="alert">{authState.error.message}</p>
      ) : session ? (
        <AccountQueryBoundary key={session.user.id}>
          <AccountSettings
            subject={session.user.id}
            email={session.user.email}
            purpose="settings"
          />
        </AccountQueryBoundary>
      ) : null}
    </DSDialog>
  );
}
