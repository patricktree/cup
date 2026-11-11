import { css } from "@linaria/core";
import { check } from "@patricktree-stack/utils-ecma/assert.utils";
import { useNavigate } from "@tanstack/react-router";
import React from "react";

import type { GrantSnapshot } from "@cup/listener-api.routes";

import { SignInDialog } from "#src/app/components/sign-in-dialog.js";
import { SourceUrlForm, wavyRuleFormStyles } from "#src/app/components/source-url-form.js";
import { ArrowRightIcon } from "#src/app/design-system/icons.js";
import { textStyles } from "#src/app/design-system/text-styles.js";
import { signedInHomeTarget } from "#src/app/signed-in-home-target.js";
import {
  useAccountConversionSubmission,
  type SignInEntry,
} from "#src/app/use-cases/account-conversions.js";
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

/** What the sign-in dialog says, by what opened it. */
const SIGN_IN_DESCRIPTIONS: Record<SignInEntry, React.ReactNode> = {
  "home-link": <>Sign in to get back to your tracks.</>,
  submission: (
    <>
      Sign in to listen. <strong>New accounts get 30 free minutes.</strong>
    </>
  ),
};

function AccountConversionForm(): React.ReactNode {
  const navigate = useNavigate();
  const submission = useAccountConversionSubmission({
    // A start survives the OAuth redirect and resumes when home mounts again.
    requestStorage: "session",
    onStarted: async (conversionId) => {
      await navigate({ to: "/audiobooks/$conversionId", params: { conversionId } });
    },
    // As the home route's redirect does, so Back does not return to the signed-out home page.
    onSignedInFromLink: async () => {
      await navigate({ to: signedInHomeTarget(), replace: true });
    },
  });
  const submitButtonRef = React.useRef<HTMLButtonElement>(null);
  const signInLinkRef = React.useRef<HTMLAnchorElement>(null);
  /** Closing the sign-in returns focus to what opened it. */
  const signInOpeners: Record<SignInEntry, React.RefObject<HTMLElement | null>> = {
    "home-link": signInLinkRef,
    submission: submitButtonRef,
  };

  return (
    <>
      <ConversionForm
        refs={{ submitButton: submitButtonRef }}
        initialSourceUrl={submission.initialSourceUrl}
        // Until auth settles, a signed-in listener may still be redirected to the Add dialog, which takes a shared URL instead.
        shouldReceiveSharedUrl={!submission.isAuthLoading}
        isPending={submission.isPending}
        retryIn={submission.retryIn}
        error={submission.isSignInOpen ? undefined : submission.error}
        onSubmit={submission.submit}
      />

      {submission.canSignIn && <SignInLine ref={signInLinkRef} onSignIn={submission.openSignIn} />}

      <SignInDialog
        open={submission.isSignInOpen}
        onOpenChange={(open) => {
          if (!open) {
            submission.cancelSignIn();
          }
        }}
        finalFocus={() => signInOpeners[submission.signInEntry].current}
        description={SIGN_IN_DESCRIPTIONS[submission.signInEntry]}
        signInMethods={submission.signInMethods}
        pendingMethod={submission.signIn.isPending ? submission.signIn.variables : undefined}
        onSignIn={submission.startSignIn}
        errorMessage={submission.signIn.error?.message}
      />
    </>
  );
}

/** The signed-out listener's way to sign in without submitting a source URL. */
function SignInLine({
  ref,
  onSignIn,
}: {
  ref: React.Ref<HTMLAnchorElement>;
  onSignIn: () => void;
}): React.ReactNode {
  return (
    <p
      className={composeClassnames(
        textStyles.paragraph,
        css`
          margin-block-start: 40px;
          margin-inline: 4px;
          color: var(--color-fg-emphasized-sm);
        `,
      )}
    >
      Already listening with Cup?{" "}
      <a
        ref={ref}
        // Opens the sign-in dialog in place; the home page has no sign-in route.
        href="#sign-in"
        onClick={(event) => {
          event.preventDefault();
          onSignIn();
        }}
        className={css`
          color: var(--color-ink);
          text-decoration: underline;
          text-underline-offset: 3px;
        `}
      >
        Sign in
      </a>
    </p>
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
        input: wavyRuleFormStyles.input,
        submitButton: wavyRuleFormStyles.submitButton,
      }}
    />
  );
}
