import { createFileRoute, Navigate } from "@tanstack/react-router";
import React from "react";

import { ConversionShell } from "#src/app/components/conversion-shell.jsx";
import { StartConversionForm } from "#src/app/components/start-conversion-form.js";
import { useAccountAuthState } from "#src/auth/hooks.js";
import { readPendingAccountConversion } from "#src/data-fetching/account-conversion-storage.js";
import { hasPendingSharedUrl } from "#src/platform/share-intake.js";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage(): React.JSX.Element {
  const authState = useAccountAuthState();
  /*
   * A start from this page that is still pending (resumed after OAuth, or waiting out a rate limit)
   * finishes here, so the redirect to Recents skips it. Read once: a successful start clears the
   * stored request before it opens the reader.
   */
  const [hasPendingStart] = React.useState(() => readPendingAccountConversion() !== null);

  if (authState.status === "signed-in" && !hasPendingStart) {
    // Share intake also navigates a signed-in listener to the Add dialog; both must end there.
    return hasPendingSharedUrl() ? (
      <Navigate to="/recent/add" replace />
    ) : (
      <Navigate to="/recent" replace />
    );
  }

  return (
    <ConversionShell>
      <StartConversionForm mode="account" />
    </ConversionShell>
  );
}
