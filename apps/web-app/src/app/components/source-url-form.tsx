import { revalidateLogic } from "@tanstack/react-form";
import React from "react";

import { startConversionRequestSchema } from "@cup/listener-api.routes";

import { useAppForm } from "#src/app/form.js";
import { summarizeError } from "#src/errors.js";
import { subscribeToSharedUrl } from "#src/platform/share-intake.js";

type SourceUrlFormProps = {
  initialSourceUrl: string;
  /** False while this form may still be replaced, so a shared URL waits for the form that stays. */
  shouldReceiveSharedUrl: boolean;
  isPending: boolean;
  retryIn: number;
  /** The failed start, shown below the form; omit it while something else explains the failure. */
  error: unknown;
  /** Shown for a failure that carries no message for the listener. */
  errorFallbackMessage: string;
  onSubmit: (value: { sourceUrl: string }) => Promise<void>;
  submitLabel: string;
  submittingLabel: string;
  sx: { form: string; input?: string; submitButton?: string };
  refs?: { submitButton?: React.Ref<HTMLButtonElement> | undefined };
};

/**
 * The source-URL field and submit button of every start form, with today's validation, and below
 * them the rate-limit countdown and the failed start. A URL shared to the app fills the field
 * without submitting it.
 */
export function SourceUrlForm({
  initialSourceUrl,
  shouldReceiveSharedUrl,
  isPending,
  retryIn,
  error,
  errorFallbackMessage,
  onSubmit,
  submitLabel,
  submittingLabel,
  sx,
  refs,
}: SourceUrlFormProps): React.JSX.Element {
  const form = useAppForm({
    defaultValues: { sourceUrl: initialSourceUrl },
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onDynamic: startConversionRequestSchema },
    onSubmit: async ({ value }) => {
      if (isPending || retryIn > 0) {
        return;
      }
      await onSubmit(value);
    },
  });

  React.useEffect(() => {
    if (!shouldReceiveSharedUrl) {
      return undefined;
    }
    return subscribeToSharedUrl((url) => form.setFieldValue("sourceUrl", url));
  }, [form, shouldReceiveSharedUrl]);

  return (
    <>
      <form
        noValidate
        className={sx.form}
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
                sx={sx.input === undefined ? undefined : { input: sx.input }}
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
                sx={{ button: sx.submitButton }}
                disabled={isPending || retryIn > 0 || !sourceUrl.trim()}
                label={submitLabel}
                submittingLabel={submittingLabel}
              />
            )}
          </form.Subscribe>
        </form.AppForm>
      </form>
      {retryIn > 0 && <output>Try again in {retryIn} seconds.</output>}
      {error ? <p role="alert">{summarizeError(error, errorFallbackMessage)}</p> : null}
    </>
  );
}
