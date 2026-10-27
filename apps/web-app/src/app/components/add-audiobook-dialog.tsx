import { css } from "@linaria/core";
import React from "react";

import { SignInButtons } from "#src/app/components/sign-in-dialog.js";
import { SourceUrlForm } from "#src/app/components/source-url-form.js";
import { DSDialog } from "#src/app/design-system/dialog.js";
import { useAccountConversionSubmission } from "#src/app/use-cases/account-conversions.js";

/**
 * Starts an account conversion from a source URL. Sign-in, the rate-limit countdown and errors stay
 * inside the dialog; it closes once the start succeeded, so the new item appears on Recents behind
 * it.
 */
export function AddAudiobookDialog({ onClose }: { onClose: () => void }): React.ReactNode {
  const submission = useAccountConversionSubmission({
    // The dialog's start never resumes on home or in a later dialog.
    requestStorage: "memory",
    // The start mutation has already invalidated the history query that Recents lists.
    onStarted: async () => onClose(),
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
      <SourceUrlForm
        initialSourceUrl={submission.initialSourceUrl}
        shouldReceiveSharedUrl
        isPending={submission.isPending}
        retryIn={submission.retryIn}
        // Sign-in explains itself in place of the failure.
        error={submission.requiresSignIn ? undefined : submission.error}
        errorFallbackMessage="The track could not be added."
        onSubmit={submission.submit}
        submitLabel="Add"
        submittingLabel="Adding…"
        sx={{
          form: css`
            display: grid;
            gap: calc(2 * var(--spacing-base));
          `,
        }}
      />

      {submission.requiresSignIn ? (
        <section aria-label="Sign in">
          <p>Sign in to listen.</p>
          <SignInButtons
            signInMethods={submission.signInMethods}
            pendingMethod={submission.signIn.isPending ? submission.signIn.variables : undefined}
            onSignIn={(method) => submission.signIn.mutate(method)}
          />
          {submission.signIn.error && <p role="alert">{submission.signIn.error.message}</p>}
        </section>
      ) : null}
    </DSDialog>
  );
}
