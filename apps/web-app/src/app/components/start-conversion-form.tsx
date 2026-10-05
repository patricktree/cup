import { css } from "@linaria/core";
import { check } from "@patricktree-stack/utils-ecma/assert.utils";
import { revalidateLogic } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import React from "react";

import { type GrantSnapshot, startConversionRequestSchema } from "@cup/web-app-api.routes";

import { SignInDialog } from "#src/app/components/sign-in-dialog.js";
import { useAppForm } from "#src/app/form.js";
import { useAccountConversionSubmission } from "#src/app/use-cases/account-conversions.js";
import { useRateLimitCountdown } from "#src/data-fetching/rate-limit.js";
import { useStartTrialConversionMutation } from "#src/data-fetching/trial-link.js";
import { subscribeToSharedUrl } from "#src/platform/share-intake.js";

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
        isPending={submission.isPending}
        retryIn={submission.retryIn}
        error={submission.requiresSignIn ? undefined : submission.error}
        onSubmit={submission.submit}
      />

      <SignInDialog
        open={submission.requiresSignIn}
        onOpenChange={(open) => {
          if (!open) submission.cancelSignIn();
        }}
        finalFocus={() => submitButtonRef.current ?? null}
        isPending={submission.signIn.isPending}
        onSignIn={() => submission.signIn.mutate()}
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
      isPending={start.isPending}
      retryIn={retryIn}
      error={start.error?.message}
      onSubmit={async ({ sourceUrl }) => {
        await start.mutateAsync(sourceUrl).catch(() => {});
      }}
    />
  );
}

function ConversionForm({
  initialSourceUrl,
  isPending,
  retryIn,
  error,
  onSubmit,
  refs,
}: {
  refs?: { submitButton?: React.Ref<HTMLButtonElement> | undefined };
  initialSourceUrl: string;
  isPending: boolean;
  retryIn: number;
  error: string | undefined;
  onSubmit: (value: { sourceUrl: string }) => Promise<void>;
}): React.ReactNode {
  const form = useAppForm({
    defaultValues: { sourceUrl: initialSourceUrl },
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onDynamic: startConversionRequestSchema },
    onSubmit: async ({ value }) => {
      if (isPending || retryIn > 0) return;
      await onSubmit(value);
    },
  });

  React.useEffect(
    () => subscribeToSharedUrl((url) => form.setFieldValue("sourceUrl", url)),
    [form],
  );

  return (
    <>
      <form
        noValidate
        className={css`
          display: grid;
          gap: calc(3 * var(--spacing-base));
          padding-block: calc(5 * var(--spacing-base));
          padding-inline: calc(2 * var(--spacing-base));

          background: var(--color-surface-translucent);
          border-radius: var(--border-radius-lg);
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
                sx={{
                  input: css`
                    height: 64px;
                    padding-inline: 24px;

                    font-family: var(--font-family-1);
                    font-size: var(--font-size-md);
                    background: var(--color-input-bg) padding-box;
                    backdrop-filter: saturate(6);

                    &::placeholder {
                      color: var(--color-fg-emphasized-sm);
                    }
                  `,
                }}
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
                refs={{ button: refs?.submitButton }}
                sx={{
                  button: css`
                    justify-self: end;
                  `,
                }}
                disabled={isPending || retryIn > 0 || !sourceUrl.trim()}
                label={"Load & listen"}
                submittingLabel="Starting conversion..."
              />
            )}
          </form.Subscribe>
        </form.AppForm>
      </form>
      {retryIn > 0 && <output>Try again in {retryIn} seconds.</output>}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
