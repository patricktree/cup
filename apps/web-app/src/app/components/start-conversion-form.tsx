import { css } from "@linaria/core";
import { check } from "@patricktree-stack/utils-ecma/assert.utils";
import { useNavigate } from "@tanstack/react-router";
import React from "react";

import type { GrantSnapshot } from "@cup/listener-api.routes";

import { SignInDialog } from "#src/app/components/sign-in-dialog.js";
import { SourceUrlForm } from "#src/app/components/source-url-form.js";
import { ArrowRightIcon } from "#src/app/design-system/icons.js";
import { textStyles } from "#src/app/design-system/text-styles.js";
import { useAccountConversionSubmission } from "#src/app/use-cases/account-conversions.js";
import { composeClassnames } from "#src/app/utils.js";
import { useStartTrialConversionMutation } from "#src/data-fetching/conversion-grant.js";
import { useRateLimitCountdown } from "#src/data-fetching/rate-limit.js";

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
    <SourceUrlForm
      initialSourceUrl={initialSourceUrl}
      shouldReceiveSharedUrl={shouldReceiveSharedUrl}
      isPending={isPending}
      retryIn={retryIn}
      error={error}
      errorFallbackMessage="The conversion could not start."
      onSubmit={onSubmit}
      placeholder="Paste website link (https://...)"
      submitLabel="Listen"
      submittingLabel="Starting conversion..."
      submitIcon={<ArrowRightIcon />}
      refs={{ submitButton: refs?.submitButton }}
      sx={{
        form: css`
          display: grid;
          gap: 23px;
          margin-block: 67px 16px;
        `,
        input: composeClassnames(
          textStyles.paragraph,
          css`
            height: 41px;
            padding-block: 0 9px;
            padding-inline: 9px;

            /* the rule's round caps overhang the column by 1 px on each side */
            margin-inline: -1px;
            background: url("./wavy-rule.svg") bottom / 100% auto no-repeat;

            /* DSInput draws a pill with a border and a shadow; the design has only the wavy rule */
            border: 0;
            border-radius: var(--border-radius-sm);
            box-shadow: none;

            &:focus-visible {
              /* the design draws no focus ring around the wavy rule; the caret marks the focused field */
              outline: none;
              /* DSInput's focus style rounds it into a pill, which would clip the rule's ends */
              border-radius: var(--border-radius-sm);
            }
          `,
        ),
        submitButton: css`
          /* wider than DSButton's gap, between the label and the arrow */
          gap: calc(2 * var(--spacing-base));
          justify-self: end;
        `,
      }}
    />
  );
}
