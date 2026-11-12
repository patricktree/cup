import { css } from "@linaria/core";
import { revalidateLogic } from "@tanstack/react-form";
import React from "react";

import { startConversionRequestSchema } from "@cup/listener-api.routes";

import { textStyles } from "#src/app/design-system/text-styles.js";
import { useAppForm } from "#src/app/form.js";
import { composeClassnames } from "#src/app/utils.js";
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
  placeholder: string;
  submitLabel: string;
  submittingLabel: string;
  submitIcon?: React.ReactNode;
  sx: { form: string; input?: string; submitButton?: string };
  refs?: {
    submitButton?: React.Ref<HTMLButtonElement> | undefined;
  };
};

/**
 * The drawn look of the home page's start form and the Add a Track sheet: the field is a wavy rule
 * with no box, and the submit button sits at the end of the row with an arrow after its label.
 */
export const wavyRuleFormStyles = {
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
} as const;

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
  placeholder,
  submitLabel,
  submittingLabel,
  submitIcon,
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
                placeholder={placeholder}
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
                icon={submitIcon}
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
