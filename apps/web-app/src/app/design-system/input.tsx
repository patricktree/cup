import { Field } from "@base-ui/react/field";
import { css } from "@linaria/core";
import React from "react";

import { composeClassnames, visuallyHidden } from "#src/app/utils.js";

export type DSInputProps = {
  errorMessage?: string | undefined;
  name?: string;
  value?: React.ComponentProps<"input">["value"];
  onBlur?: React.ComponentProps<"input">["onBlur"];
  onValueChange?: Field.Control.Props["onValueChange"];
  invalid?: Field.Root.Props["invalid"];
  dirty?: Field.Root.Props["dirty"];
  touched?: Field.Root.Props["touched"];
  sx?: { label?: string; input?: string } | undefined;
  autoComplete?: React.ComponentProps<"input">["autoComplete"];
  disabled?: boolean | undefined;
  label: string;
  maxLength?: number | undefined;
  placeholder?: string | undefined;
  required?: boolean | undefined;
  type?: "email" | "password" | "text" | "url";
  hideLabel?: boolean | undefined;
};

export function DSInput({
  sx,
  autoComplete,
  disabled,
  label,
  maxLength,
  placeholder,
  required,
  type = "text",
  hideLabel = false,
  errorMessage,
  name,
  value,
  onBlur,
  onValueChange,
  invalid = errorMessage !== undefined,
  dirty,
  touched,
}: DSInputProps): React.JSX.Element {
  return (
    <Field.Root
      name={name}
      disabled={disabled}
      invalid={invalid}
      dirty={dirty}
      touched={touched}
      className={composeClassnames(
        css`
          display: flex;
          flex-direction: column;
          gap: calc(0.5 * var(--spacing-base));
        `,
        sx?.label,
      )}
    >
      <Field.Label className={hideLabel ? visuallyHidden : undefined}>{label}</Field.Label>
      <Field.Control
        className={composeClassnames(
          css`
            padding-block: calc(1.5 * var(--spacing-base));
            padding-inline: calc(2.5 * var(--spacing-base));

            font-size: 18px;
            color: var(--color-fg);
            border: 2px solid transparent;
            border-radius: 999px;
            box-shadow: 4px 4px 20px rgb(0 0 0 / 12%);

            &:focus-visible {
              border-radius: 999px;
            }

            &::placeholder {
              color: var(--color-fg-emphasized-xs);
            }
          `,
          sx?.input,
        )}
        autoComplete={autoComplete}
        disabled={disabled}
        maxLength={maxLength}
        placeholder={placeholder}
        required={required}
        type={type}
        value={value}
        onBlur={onBlur}
        onValueChange={onValueChange}
      />
      {errorMessage === undefined ? null : (
        <Field.Error
          match={invalid}
          render={<small />}
          className={css`
            color: var(--color-error);
          `}
          role="alert"
        >
          {errorMessage}
        </Field.Error>
      )}
    </Field.Root>
  );
}
