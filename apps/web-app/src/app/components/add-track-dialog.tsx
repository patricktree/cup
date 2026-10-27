import { css } from "@linaria/core";
import React from "react";

import { SIGN_IN_LABELS } from "#src/app/components/sign-in-dialog.js";
import { useSourceUrlForm } from "#src/app/components/start-conversion-form.js";
import { DSButton } from "#src/app/design-system/button.js";
import { DSDialog } from "#src/app/design-system/dialog.js";
import { useAccountConversionSubmission } from "#src/app/use-cases/account-conversions.js";
import { summarizeError } from "#src/errors.js";

/**
 * Starts an account conversion from a source URL. Sign-in, the rate-limit countdown and errors stay
 * inside the dialog; it closes once the start succeeded, so the new item appears on Recents behind
 * it.
 */
export function AddTrackDialog({ onClose }: { onClose: () => void }): React.ReactNode {
  const submission = useAccountConversionSubmission({
    // The start mutation has already invalidated the history query that Recents lists.
    onStarted: async () => onClose(),
  });
  const form = useSourceUrlForm({
    initialSourceUrl: submission.initialSourceUrl,
    shouldReceiveSharedUrl: true,
    isPending: submission.isPending,
    retryIn: submission.retryIn,
    onSubmit: submission.submit,
  });

  return (
    <DSDialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      initialFocus={undefined}
      finalFocus={undefined}
      title={<>Add a track</>}
      cancelButtonText={<>Cancel</>}
      cancelButtonDisabled={submission.signIn.isPending}
    >
      <form
        noValidate
        className={css`
          display: grid;
          gap: calc(2 * var(--spacing-base));
        `}
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <form.AppForm>
          <form.AppField name="sourceUrl">
            {(field) => (
              <field.TextField
                label="URL"
                maxLength={2048}
                required
                type="url"
                placeholder="Paste URL here"
                hideLabel
              />
            )}
          </form.AppField>
          <form.Subscribe selector={(state) => state.values.sourceUrl}>
            {(sourceUrl) => (
              <form.SubmitButton
                disabled={submission.isPending || submission.retryIn > 0 || !sourceUrl.trim()}
                label="Add"
                submittingLabel="Adding…"
              />
            )}
          </form.Subscribe>
        </form.AppForm>
      </form>

      {submission.retryIn > 0 && <output>Try again in {submission.retryIn} seconds.</output>}
      {submission.requiresSignIn ? (
        <section aria-label="Sign in">
          <p>Sign in to listen.</p>
          {submission.signInMethods.map((method) => (
            <DSButton
              key={method}
              variant="contained"
              disabled={submission.signIn.isPending}
              onClick={() => submission.signIn.mutate(method)}
            >
              {submission.signIn.isPending && submission.signIn.variables === method
                ? "Signing in…"
                : SIGN_IN_LABELS[method]}
            </DSButton>
          ))}
          {submission.signIn.error && <p role="alert">{submission.signIn.error.message}</p>}
        </section>
      ) : submission.error ? (
        <p role="alert">{summarizeError(submission.error, "The track could not be added.")}</p>
      ) : null}
    </DSDialog>
  );
}
