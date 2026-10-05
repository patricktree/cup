import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { Temporal } from "temporal-polyfill";

import { AccountQueryBoundary } from "#src/app/components/account-query-boundary.js";
import { DSButton } from "#src/app/design-system/button.js";
import { useAccountSession, useAccountAuthState } from "#src/auth/hooks.js";
import { useAccountConfirmation } from "#src/data-fetching/account-confirmation.js";
import { accountQuery } from "#src/data-fetching/account.js";

export const Route = createFileRoute("/account")({
  component: AccountPage,
});
function AccountPage(): React.ReactNode {
  const session = useAccountSession();
  const authState = useAccountAuthState();
  return (
    <>
      <h1>Account settings</h1>
      {authState.status === "loading" ? (
        <output>Loading account…</output>
      ) : authState.status === "error" ? (
        <p role="alert">{authState.error.message}</p>
      ) : session ? (
        <AccountQueryBoundary key={session.user.id}>
          <AccountSettings subject={session.user.id} email={session.user.email} />
        </AccountQueryBoundary>
      ) : (
        <p>Sign in with Google to manage or restore your account.</p>
      )}
    </>
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
  if (account.error && !account.isFetching) throw account.error;
  return (
    <>
      <p>{email}</p>
      {data.state === "active" ? (
        <section aria-label="Delete account">
          <h2>Delete account</h2>
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
          <h2>Deletion scheduled</h2>
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
