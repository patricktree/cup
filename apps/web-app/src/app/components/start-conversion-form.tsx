import { Dialog } from "@base-ui/react/dialog";
import { css } from "@linaria/core";
import { check } from "@patricktree-stack/utils-ecma/assert.utils";
import { revalidateLogic } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import React from "react";

import { type GrantSnapshot, startConversionRequestSchema } from "@cup/web-app-api.routes";

import { DSButton } from "#src/app/design-system/button.js";
import { useAppForm } from "#src/app/form.js";
import { useAccountConversionSubmission } from "#src/data-fetching/account-conversions.js";
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
  const submission = useAccountConversionSubmission(async (conversionId) => {
    await navigate({ to: "/conversions/$conversionId", params: { conversionId } });
  });
  const signInButton = React.useRef<HTMLButtonElement>(null);
  const formElement = React.useRef<HTMLFormElement>(null);
  return (
    <>
      <ConversionForm
        formRef={formElement}
        initialSourceUrl={submission.initialSourceUrl}
        isPending={submission.isPending}
        retryIn={submission.retryIn}
        error={submission.requiresSignIn ? undefined : submission.error}
        onSubmit={submission.submit}
      />
      <Dialog.Root
        open={submission.requiresSignIn}
        onOpenChange={(open) => {
          if (!open) submission.cancelSignIn();
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop
            className={css`
              position: fixed;
              inset: 0;
              z-index: 1000;
              background: hsl(var(--color-black-hsl) / 35%);
            `}
          />
          <Dialog.Popup
            initialFocus={signInButton}
            finalFocus={() => formElement.current?.querySelector("button") ?? null}
            className={css`
              position: fixed;
              top: 50%;
              left: 50%;
              z-index: 1001;
              display: grid;
              gap: calc(3 * var(--spacing-base));
              width: min(440px, calc(100vw - 32px));
              max-height: calc(100dvh - 32px);
              padding: calc(3 * var(--spacing-base));
              overflow: auto;
              font-family: var(--font-family-1);
              color: var(--color-fg);
              background: var(--color-bg);
              border-radius: var(--border-radius-lg);
              transform: translate(-50%, -50%);
            `}
          >
            <Dialog.Title
              className={css`
                font-size: var(--font-size-lg);
              `}
            >
              Sign in to convert
            </Dialog.Title>
            <Dialog.Description>
              Sign in to start converting. New accounts get 30 free minutes.
            </Dialog.Description>
            <DSButton
              ref={signInButton}
              variant="contained"
              disabled={submission.signIn.isPending}
              onClick={() => submission.signIn.mutate()}
            >
              {submission.signIn.isPending ? "Signing in…" : "Continue with Google"}
            </DSButton>
            <Dialog.Close render={<DSButton disabled={submission.signIn.isPending} />}>
              Cancel
            </Dialog.Close>
            {submission.signIn.error && <p role="alert">{submission.signIn.error.message}</p>}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function TrialConversionForm({ grant }: { grant: GrantSnapshot }): React.ReactNode {
  const navigate = useNavigate();
  const start = useStartTrialConversionMutation(grant.grantId, async (conversionId) => {
    await navigate({ to: "/conversions/$conversionId", params: { conversionId } });
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
  formRef,
}: {
  initialSourceUrl: string;
  isPending: boolean;
  retryIn: number;
  error: string | undefined;
  onSubmit: (value: { sourceUrl: string }) => Promise<void>;
  formRef?: React.Ref<HTMLFormElement>;
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
        ref={formRef}
        noValidate
        className={css`
          position: relative;
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
                sx={{
                  button: css`
                    justify-self: end;
                  `,
                }}
                disabled={isPending || retryIn > 0 || !sourceUrl.trim()}
                label={isPending ? "Starting conversion..." : "Load & listen"}
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
