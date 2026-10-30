import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";
import React from "react";

import { AccountLoadError, AccountLoading } from "#src/app/components/account-load-states.js";
import { AccountSettings } from "#src/app/components/account-settings.js";
import { DSDialog } from "#src/app/design-system/dialog.js";
import { useCloseRecentsDialog } from "#src/app/use-close-recents-dialog.js";
import { useAccountSession } from "#src/auth/hooks.js";
import { useIsAccountConfirmationPending } from "#src/data-fetching/account-confirmation.js";
import { accountQuery } from "#src/data-fetching/account.js";

/**
 * The account dialog over Recents. Unlike the Add dialog, no route mask hides its URL: confirming a
 * deletion or recovery signs in with Google again, and that sign-in returns to the URL bar's path,
 * where the dialog has to open again to show the confirmation step.
 */
export const Route = createFileRoute("/_shell/recent/account")({
  component: AccountDialog,
  // Recents' `beforeLoad` has settled auth and put the signed-in subject into the context.
  loader: async ({ context }) => {
    await context.queryClient.query({ ...accountQuery(context.subject), staleTime: "static" });
  },
  pendingComponent: () => (
    <AccountDialogFrame>
      <AccountLoading />
    </AccountDialogFrame>
  ),
  errorComponent: ({ error }: ErrorComponentProps) => (
    <AccountDialogFrame>
      <AccountLoadError error={error} />
    </AccountDialogFrame>
  ),
});

function AccountDialog(): React.ReactNode {
  const session = useAccountSession();

  return (
    <AccountDialogFrame>
      {/* Signed out, Recents behind the dialog redirects home. */}
      {session && (
        <AccountSettings
          key={session.user.id}
          subject={session.user.id}
          email={session.user.email}
          purpose="settings"
        />
      )}
    </AccountDialogFrame>
  );
}

function AccountDialogFrame({ children }: { children: React.ReactNode }): React.JSX.Element {
  const close = useCloseRecentsDialog(Route.id);
  // Leaving while a step runs would lose the return from Google, which comes back to this URL.
  const isConfirmationPending = useIsAccountConfirmationPending();
  // Close takes the initial focus: the first tabbable button can be a step such as "Schedule
  // deletion", which one Enter would run.
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);

  return (
    <DSDialog
      open
      onOpenChange={(open) => {
        if (!open && !isConfirmationPending) {
          close();
        }
      }}
      initialFocus={closeButtonRef}
      finalFocus={undefined}
      title={<>Account settings</>}
      cancelButtonText={<>Close</>}
      cancelButtonDisabled={isConfirmationPending}
      cancelButtonRef={closeButtonRef}
    >
      {children}
    </DSDialog>
  );
}
