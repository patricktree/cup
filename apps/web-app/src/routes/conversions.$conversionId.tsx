import { css } from "@linaria/core";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Navigate,
  useNavigate,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import React from "react";

import { ConversionPhase, conversionPhaseOrder } from "@cup/conversion-grants/contracts";

import { ErrorMessage } from "#src/app/components/error-message.js";
import { DSButton } from "#src/app/design-system/button.js";
import { createConversionQuery } from "#src/data-fetching/trial-link.js";

const CONVERSION_PHASE_LABELS = {
  [ConversionPhase.CONVERSION_START]: "Starting conversion",
  [ConversionPhase.SOURCE_MATERIAL_PREPARATION]: "Preparing audiobook source material",
  [ConversionPhase.NARRATION_CONTENT_SELECTION]: "Selecting narration content",
  [ConversionPhase.NARRATION_DOCUMENT_CREATION]: "Creating narration document",
  [ConversionPhase.AUDIO_SEGMENT_PRODUCTION]: "Producing narration audio",
  [ConversionPhase.AUDIOBOOK_ASSEMBLY]: "Assembling audiobook audio",
  [ConversionPhase.AUDIOBOOK_STORAGE]: "Storing audiobook",
  [ConversionPhase.FINALIZATION]: "Finalizing conversion",
} as const satisfies Record<ConversionPhase, string>;

export const Route = createFileRoute("/conversions/$conversionId")({
  component: ConversionPage,
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(createConversionQuery(params.conversionId));
  },
  errorComponent: RouteErrorComponent,
});

function ConversionPage(): React.JSX.Element {
  const { conversionId } = Route.useParams();
  const conversionQuery = useSuspenseQuery(createConversionQuery(conversionId));

  if (conversionQuery.data.status === "ready") {
    return (
      <Navigate to="/audiobooks/$conversionId" params={{ conversionId: conversionId }} replace />
    );
  }

  if (conversionQuery.data.status === "pending") {
    return <PendingConversionProgress lastStartedPhase={conversionQuery.data.lastStartedPhase} />;
  }

  return (
    <ErrorMessage title="Conversion failed.">
      <span>{conversionQuery.data.failure.explanation}</span>
    </ErrorMessage>
  );
}

function PendingConversionProgress({
  lastStartedPhase,
}: {
  lastStartedPhase: ConversionPhase;
}): React.JSX.Element {
  const completedPhases = conversionPhaseOrder.indexOf(lastStartedPhase) + 1;

  return (
    <>
      <div
        className={css`
          display: grid;
          gap: calc(6 * var(--spacing-base));
          justify-items: center;
        `}
      >
        <output
          aria-live="polite"
          className={css`
            font-family: var(--font-family-2);
            font-size: var(--font-size-lg);
            color: var(--color-fg-emphasized-sm);
          `}
        >
          ({completedPhases}/{conversionPhaseOrder.length}){" "}
          {CONVERSION_PHASE_LABELS[lastStartedPhase]}...
        </output>
      </div>
    </>
  );
}

function RouteErrorComponent(_props: ErrorComponentProps): React.JSX.Element {
  const navigate = useNavigate();

  return (
    <ErrorMessage title="The conversion could not be opened.">
      <DSButton
        type="button"
        variant="contained"
        onClick={() => navigate({ to: ".", reloadDocument: true })}
      >
        Try again
      </DSButton>
    </ErrorMessage>
  );
}
