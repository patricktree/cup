import { css } from "@linaria/core";
import { check } from "@patricktree-stack/utils-ecma/assert.utils";
import { useNavigate } from "@tanstack/react-router";
import React from "react";

import type { GrantSnapshot } from "@cup/listener-api.routes";

import { SignInDialog } from "#src/app/components/sign-in-dialog.js";
import { SourceUrlForm } from "#src/app/components/source-url-form.js";
import { useAccountConversionSubmission } from "#src/app/use-cases/account-conversions.js";
import { useStartTrialConversionMutation } from "#src/data-fetching/conversion-grant.js";
import { useRateLimitCountdown } from "#src/data-fetching/rate-limit.js";
import { summarizeError } from "#src/errors.js";

type StartConversionFormProps =
  | { mode: "account"; grant?: never }
  | { mode: "trial"; grant: GrantSnapshot };

export function StartConversionForm(props: StartConversionFormProps): React.ReactNode {
  if (props.mode === "trial") {
    return <TrialConversionForm grant={props.grant} />;
  } else if (props.mode === "account") {
    return <AccountConversionForm />;
  }

  return check.assertIsUnreachable(props);
}

function AccountConversionForm(): React.ReactNode {
  const navigate = useNavigate();
  const submission = useAccountConversionSubmission({
    // A start survives the OAuth redirect and resumes when home mounts again.
    requestStorage: "session",
    onStarted: async (conversionId) => {
      await navigate({ to: "/audiobooks/$conversionId", params: { conversionId } });
    },
  });
  const submitButtonRef = React.useRef<HTMLButtonElement>(null);

  return (
    <>
      <ConversionForm
        refs={{ submitButton: submitButtonRef }}
        initialSourceUrl={submission.initialSourceUrl}
        // Until auth settles, a signed-in listener may still be redirected to the Add dialog, which takes a shared URL instead.
        shouldReceiveSharedUrl={!submission.isAuthLoading}
        isPending={submission.isPending}
        retryIn={submission.retryIn}
        error={submission.requiresSignIn ? undefined : submission.error}
        onSubmit={submission.submit}
      />

      <SignInDialog
        open={submission.requiresSignIn}
        onOpenChange={(open) => {
          if (!open) {
            submission.cancelSignIn();
          }
        }}
        finalFocus={() => submitButtonRef.current ?? null}
        signInMethods={submission.signInMethods}
        pendingMethod={submission.signIn.isPending ? submission.signIn.variables : undefined}
        onSignIn={(method) => submission.signIn.mutate(method)}
        errorMessage={submission.signIn.error?.message}
      />
    </>
  );
}

function TrialConversionForm({ grant }: { grant: GrantSnapshot }): React.ReactNode {
  const navigate = useNavigate();
  const start = useStartTrialConversionMutation(grant.grantId, {
    onStarted: async (conversionId) => {
      await navigate({ to: "/audiobooks/$conversionId", params: { conversionId } });
    },
  });
  const retryIn = useRateLimitCountdown(start.error);
  return (
    <ConversionForm
      initialSourceUrl=""
      shouldReceiveSharedUrl
      isPending={start.isPending}
      retryIn={retryIn}
      error={start.error}
      onSubmit={async ({ sourceUrl }) => {
        await start.mutateAsync(sourceUrl).catch(() => {});
      }}
    />
  );
}

function ConversionForm({
  initialSourceUrl,
  shouldReceiveSharedUrl,
  isPending,
  retryIn,
  error,
  onSubmit,
  refs,
}: {
  refs?: { submitButton?: React.Ref<HTMLButtonElement> | undefined };
  initialSourceUrl: string;
  shouldReceiveSharedUrl: boolean;
  isPending: boolean;
  retryIn: number;
  error: unknown;
  onSubmit: (value: { sourceUrl: string }) => Promise<void>;
}): React.ReactNode {
  return (
    <>
      <SourceUrlForm
        initialSourceUrl={initialSourceUrl}
        shouldReceiveSharedUrl={shouldReceiveSharedUrl}
        isPending={isPending}
        retryIn={retryIn}
        onSubmit={onSubmit}
        submitLabel="Load & listen"
        submittingLabel="Starting conversion..."
        refs={{ submitButton: refs?.submitButton }}
        sx={{
          form: css`
            display: grid;
            gap: calc(3 * var(--spacing-base));
            padding-block: calc(5 * var(--spacing-base));
            padding-inline: calc(2 * var(--spacing-base));
          `,
          input: css`
            height: 64px;
            padding-inline: 24px;

            font-family: var(--font-family-1);
            font-size: var(--font-size-md);
            background: var(--color-surface) padding-box;
            backdrop-filter: saturate(6);

            &::placeholder {
              color: var(--color-fg-emphasized-sm);
            }
          `,
          submitButton: css`
            justify-self: end;
          `,
        }}
      />
      {retryIn > 0 && <output>Try again in {retryIn} seconds.</output>}
      {error ? (
        <p role="alert">{summarizeError(error, "The conversion could not start.")}</p>
      ) : null}
    </>
  );
}
