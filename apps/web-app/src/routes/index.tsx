import { createFileRoute, redirect } from "@tanstack/react-router";
import React from "react";

import { ConversionShell } from "#src/app/components/conversion-shell.jsx";
import { PageSkeleton } from "#src/app/components/page-skeleton.js";
import { StartConversionForm } from "#src/app/components/start-conversion-form.js";
import { signedInHomeTarget } from "#src/app/signed-in-home-target.js";
import { settleAccountSession } from "#src/auth/account-session.js";
import { readPendingAccountConversion } from "#src/data-fetching/account-conversion-storage.js";

export const Route = createFileRoute("/")({
  component: IndexPage,
  beforeLoad: async () => {
    // Failing auth counts as signed out here, so home still offers the start form, which needs no
    // account until it is submitted: signing in initializes auth again (`ensureAuthInitialized`)
    // and shows that failure in place.
    const session = await settleAccountSession().catch(() => null);
    /*
     * A start from this page that is still pending (resumed after OAuth, or waiting out a rate
     * limit) finishes here, so the redirect to Recents skips it. A successful start clears the
     * stored request before it opens the reader.
     */
    if (session && readPendingAccountConversion() === null) {
      throw redirect({ to: signedInHomeTarget(), replace: true });
    }
  },
  // Shown only on a cold start, while auth settles.
  pendingComponent: () => <PageSkeleton label="Loading" />,
});

function IndexPage(): React.JSX.Element {
  return (
    <ConversionShell>
      <StartConversionForm mode="account" />
    </ConversionShell>
  );
}
