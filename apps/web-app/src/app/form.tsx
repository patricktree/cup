import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import React from "react";

import { DSButton } from "#src/app/design-system/button.js";
import { DSInput, type DSInputProps } from "#src/app/design-system/input.js";

const { fieldContext, formContext, useFieldContext, useFormContext } = createFormHookContexts();

type TextFieldProps = Pick<
  DSInputProps,
  | "sx"
  | "autoComplete"
  | "disabled"
  | "label"
  | "maxLength"
  | "placeholder"
  | "required"
  | "type"
  | "hideLabel"
>;

function TextField({
  sx,
  autoComplete,
  disabled,
  label,
  maxLength,
  placeholder,
  required,
  type = "text",
  hideLabel = false,
}: TextFieldProps): React.JSX.Element {
  const field = useFieldContext<string>();
  const errorMessage =
    field.state.meta.errors
      .map(getErrorMessage)
      .filter((message) => message !== undefined)
      .join(", ") || undefined;

  return (
    <DSInput
      sx={sx}
      autoComplete={autoComplete}
      disabled={disabled}
      label={label}
      maxLength={maxLength}
      placeholder={placeholder}
      required={required}
      type={type}
      hideLabel={hideLabel}
      errorMessage={errorMessage}
      invalid={!field.state.meta.isValid}
      dirty={field.state.meta.isDirty}
      touched={field.state.meta.isTouched}
      name={field.name}
      value={field.state.value}
      onBlur={field.handleBlur}
      onValueChange={field.handleChange}
    />
  );
}

type SubmitButtonProps = {
  sx?: { button: string };
  disabled?: boolean;
  disabledWhenPristine?: boolean;
  label: string;
  submittingLabel?: string;
};

function SubmitButton({
  sx,
  disabled = false,
  disabledWhenPristine = false,
  label,
  submittingLabel = label,
}: SubmitButtonProps): React.JSX.Element {
  const form = useFormContext();

  return (
    <form.Subscribe
      selector={(state) => [state.canSubmit, state.isPristine, state.isSubmitting] as const}
    >
      {([canSubmit, isPristine, isSubmitting]) => (
        <DSButton
          className={sx?.button}
          disabled={disabled || !canSubmit || (disabledWhenPristine && isPristine)}
          isPending={isSubmitting}
          type="submit"
          variant="contained"
        >
          {isSubmitting ? submittingLabel : label}
        </DSButton>
      )}
    </form.Subscribe>
  );
}

/** Application form hook preconfigured with the shared field and form components. */
export const { useAppForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField,
  },
  formComponents: {
    SubmitButton,
  },
});

function getErrorMessage(error: unknown): string | undefined {
  if (typeof error === "string") {
    return error;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return undefined;
}
