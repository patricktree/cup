import { css } from "@linaria/core";
import { revalidateLogic } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import React from "react";

import { type GrantSnapshot, startConversionRequestSchema } from "@cup/web-app-api.routes";

import { MovingEllipse } from "#src/app/components/moving-ellipse.js";
import { useAppForm } from "#src/app/form.js";
import { useStartConversionMutation } from "#src/data-fetching/trial-link.js";
import { subscribeToSharedUrl } from "#src/platform/share-intake.js";

export function StartConversionForm({ grant }: { grant: GrantSnapshot }): React.JSX.Element {
  const navigate = useNavigate();
  const startConversionMutation = useStartConversionMutation(grant.grantId);
  const form = useAppForm({
    defaultValues: { sourceUrl: "" },
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: {
      onDynamic: startConversionRequestSchema,
    },
    onSubmit: async ({ value }) => {
      const result = await startConversionMutation.mutateAsync({
        sourceUrl: value.sourceUrl,
        idempotencyKey: crypto.randomUUID(),
      });
      form.reset();
      await navigate({
        to: "/conversions/$conversionId",
        params: { conversionId: result.conversion.conversionId },
      });
    },
  });

  React.useEffect(() => {
    return subscribeToSharedUrl((url) => form.setFieldValue("sourceUrl", url));
  }, [form]);

  return (
    <form
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
      <MovingEllipse />
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
                  /* Reveal the moving ellipse only through the transparent border. */
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
        <form.SubmitButton
          sx={{
            button: css`
              justify-self: end;
            `,
          }}
          disabledWhenPristine
          label="Load & listen"
          submittingLabel="Starting conversion..."
        />
      </form.AppForm>
    </form>
  );
}
