import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import React from "react";
import { Temporal } from "temporal-polyfill";

import { DSButton } from "#src/app/design-system/button.js";
import { useAccountConfirmation } from "#src/data-fetching/account-confirmation.js";
import { accountQuery } from "#src/data-fetching/account.js";

/**
 * The account's lifecycle controls: deleting an active account, restoring one whose deletion is
 * scheduled, and confirming either after signing in with Google again. The account dialog offers
 * both; the account recovery page offers restoring only, and sends an active account to Recents.
 * Render it inside an `AccountQueryBoundary`.
 */
export function AccountSettings({
  subject,
  email,
  purpose,
}: {
  subject: string;
  email: string | undefined;
  purpose: "settings" | "recovery";
}): React.ReactNode {
  const account = useSuspenseQuery(accountQuery(subject));
  const confirmation = useAccountConfirmation(subject);
  const { isPending: pending, error, result, begin, confirm, cancel } = confirmation;
  // A deletion begun in the account dialog but not confirmed stays stored for this tab; the recovery
  // page must not offer to finish it.
  const challenge =
    purpose === "recovery" && confirmation.challenge?.action === "delete"
      ? null
      : confirmation.challenge;
  // Each section heading sits one level below the dialog's h2 title or the page's h1.
  const SectionHeading = purpose === "settings" ? "h3" : "h2";
  const data = account.data;
  if (account.error && !account.isFetching) {
    throw account.error;
  }
  return (
    <>
      <p>{email}</p>
      {data.state === "active" ? (
        purpose === "settings" ? (
          <section aria-label="Delete account">
            <SectionHeading>Delete account</SectionHeading>
            <p>
              Access stops immediately. You can restore this account for seven days. After that,
              your account and private conversions are deleted. Original trial conversions stay
              separate.
            </p>
            <DSButton disabled={pending} onClick={() => begin("delete")}>
              Delete account…
            </DSButton>
          </section>
        ) : (
          <p>
            This account is not scheduled for deletion. <Link to="/recent">Go to Recent</Link>
          </p>
        )
      ) : (
        <section aria-label="Account recovery">
          <SectionHeading>Deletion scheduled</SectionHeading>
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
