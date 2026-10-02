import { css } from "@linaria/core";
import { createMemoryHistory } from "@tanstack/react-router";
import type { ResolveParams } from "@tanstack/react-router";
import { http, HttpResponse } from "msw";
import React from "react";

import type { Story } from "#ui-gallery/story.js";

import { ConversionPhase, conversionPhaseOrder } from "@cup/conversion-contracts";
import type { ConversionDetail, ErrorResponse } from "@cup/web-app-api.routes";

import { DSButton } from "#src/app/design-system/button.js";
import { createAppRouter, GlobalProviders } from "#src/app/global-providers.js";
import { createConversionQuery } from "#src/data-fetching/trial-link.js";
import { Route as conversionRoute } from "#src/routes/conversions.$conversionId.js";

const CONVERSION_ID = "a3fcb5d8-9162-4c1a-b804-3be130c5e92a";
const memoryHistory = createMemoryHistory({ initialEntries: ["/app/"] });
// TanStack initializes route objects in place, so this story module must create one router only.
const router = createAppRouter(memoryHistory);

export const PendingConversion = pendingConversionStory(
  ConversionPhase.NARRATION_CONTENT_SELECTION,
);
export const StartingConversion = pendingConversionStory(ConversionPhase.CONVERSION_START);
export const HalfCompleteConversion = pendingConversionStory(
  ConversionPhase.AUDIO_SEGMENT_PRODUCTION,
);
export const FinalizingConversion = pendingConversionStory(ConversionPhase.FINALIZATION);

function pendingConversionStory(lastStartedPhase: ConversionPhase): Story {
  return {
    component: () => <ConversionRoute />,
    handlers: [
      http.get(`/api/conversions/${CONVERSION_ID}`, () =>
        HttpResponse.json({
          conversionId: CONVERSION_ID,
          sourceUrl: "https://example.com/article",
          acceptedAt: "2026-08-28T10:05:00Z",
          status: "pending",
          lastStartedPhase,
        } satisfies ConversionDetail),
      ),
    ],
  };
}

export const InteractiveConversion = {
  component: () => (
    <>
      <ConversionRoute />
      <PhaseControls />
    </>
  ),
  handlers: [
    http.get(`/api/conversions/${CONVERSION_ID}`, () =>
      HttpResponse.json(
        router.options.context.queryClient.getQueryData(
          createConversionQuery(CONVERSION_ID).queryKey,
        ) ??
          ({
            conversionId: CONVERSION_ID,
            sourceUrl: "https://example.com/article",
            acceptedAt: "2026-08-28T10:05:00Z",
            status: "pending",
            lastStartedPhase: ConversionPhase.CONVERSION_START,
          } satisfies ConversionDetail),
      ),
    ),
  ],
} satisfies Story;

function PhaseControls(): React.JSX.Element {
  const [phaseIndex, setPhaseIndex] = React.useState(0);
  const isLastPhase = phaseIndex === conversionPhaseOrder.length - 1;

  return (
    <div
      className={css`
        position: fixed;
        inset-inline: 0;
        bottom: calc(3 * var(--spacing-base));
        display: grid;
        gap: var(--spacing-base);
        justify-items: center;
      `}
    >
      <p>
        {phaseIndex} of {conversionPhaseOrder.length} phases completed (
        {(phaseIndex / conversionPhaseOrder.length) * 100}%)
      </p>
      <DSButton
        variant="contained"
        onClick={() => {
          const nextIndex = isLastPhase ? 0 : phaseIndex + 1;
          router.options.context.queryClient.setQueryData(
            createConversionQuery(CONVERSION_ID).queryKey,
            {
              conversionId: CONVERSION_ID,
              sourceUrl: "https://example.com/article",
              acceptedAt: "2026-08-28T10:05:00Z",
              status: "pending",
              lastStartedPhase: conversionPhaseOrder[nextIndex]!,
            } satisfies ConversionDetail,
          );
          setPhaseIndex(nextIndex);
        }}
      >
        {isLastPhase ? "Start again" : "Next phase"}
      </DSButton>
    </div>
  );
}

export const FailedConversion = {
  component: () => <ConversionRoute />,
  handlers: [
    http.get(`/api/conversions/${CONVERSION_ID}`, () =>
      HttpResponse.json({
        conversionId: CONVERSION_ID,
        sourceUrl: "https://source.example.test/fixture",
        acceptedAt: "2026-08-28T10:05:00Z",
        status: "failed",
        completedAt: "2026-08-28T10:08:00Z",
        failure: { category: "narration-synthesis", explanation: "Speech synthesis failed." },
      } satisfies ConversionDetail),
    ),
  ],
} satisfies Story;

export const ConversionLoadError = {
  component: () => <ConversionRoute />,
  handlers: [
    http.get(`/api/conversions/${CONVERSION_ID}`, () =>
      HttpResponse.json(
        {
          error: {
            requestId: "09e6d824-d41d-43bb-9417-18f89232ba56",
            code: "operational-error",
            message: "The conversion could not be loaded.",
          },
        } satisfies ErrorResponse,
        { status: 500 },
      ),
    ),
  ],
} satisfies Story;

function ConversionRoute() {
  const location = router.buildLocation({
    to: conversionRoute.fullPath,
    params: { conversionId: CONVERSION_ID } satisfies ResolveParams<
      typeof conversionRoute.fullPath
    >,
  });
  memoryHistory.replace(location.href);

  return <GlobalProviders router={router} />;
}
