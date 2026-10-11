import { createMemoryHistory } from "@tanstack/react-router";
import { http, HttpResponse } from "msw";
import React from "react";

import type { Audiobook, ErrorResponse, RetryConversionResponse } from "@cup/web-app-api.routes";

import { createAppRouter, GlobalProviders } from "#src/app/global-providers.js";
import { queryClient } from "#src/data-fetching/query-client.js";
import { createAudiobookQuery } from "#src/data-fetching/trial-link.js";
import gatesNotesAudiobook from "#src/ui-gallery/gates-notes-audiobook.json" with { type: "json" };
import type { Story } from "#src/ui-gallery/story.js";

const CONVERSION_ID = "693af4c4-9fa8-430d-9dc5-c00e88fb38a7";
const SOURCE_URL = "https://source.example.test/fixture";
const memoryHistory = createMemoryHistory({ initialEntries: [`/app/audiobooks/${CONVERSION_ID}`] });
const router = createAppRouter(memoryHistory);

export const ReadyAudiobook = {
  beforeMount: async () => {
    // Keep preloaded data until the story mounts; the app normally collects unused queries immediately.
    await queryClient.fetchQuery({ ...createAudiobookQuery(CONVERSION_ID), gcTime: Infinity });
    await router.load();
  },
  component: () => <GlobalProviders router={router} />,
  handlers: [
    http.get(`/api/audiobooks/${CONVERSION_ID}`, () => HttpResponse.json(createAudiobook())),
  ],
} satisfies Story;

const GATES_NOTES_CONVERSION_ID = "7b1736db-31f7-46ba-b6b5-d965770b355b";
// The local fixture uses createNarrationDocument on the Gates Notes E2E article's subtitle and body.
const gatesNotesRouter = createAppRouter(
  createMemoryHistory({ initialEntries: [`/app/audiobooks/${GATES_NOTES_CONVERSION_ID}`] }),
);

export const GatesNotesArticle = {
  beforeMount: async () => {
    await queryClient.fetchQuery({
      ...createAudiobookQuery(GATES_NOTES_CONVERSION_ID),
      gcTime: Infinity,
    });
    await gatesNotesRouter.load();
  },
  component: () => <GlobalProviders router={gatesNotesRouter} />,
  handlers: [
    http.get(`/api/audiobooks/${GATES_NOTES_CONVERSION_ID}`, () =>
      HttpResponse.json({
        ...gatesNotesAudiobook,
        status: "ready",
        segments: gatesNotesAudiobook.narrationDocument.synchronizationUnits.map(
          (_unit, sequence) => createReadySegment(sequence),
        ),
      } satisfies Audiobook),
    ),
  ],
} satisfies Story;

export const AudiobookNotFound = {
  component: () => <GlobalProviders router={router} />,
  handlers: [
    http.get(`/api/audiobooks/${CONVERSION_ID}`, () =>
      HttpResponse.json(
        {
          error: {
            requestId: "09e6d824-d41d-43bb-9417-18f89232ba56",
            code: "audiobook-not-found",
            message: "The audiobook was not found.",
          },
        } satisfies ErrorResponse,
        { status: 404 },
      ),
    ),
  ],
} satisfies Story;

export const AudiobookLoadError = {
  component: () => <GlobalProviders router={router} />,
  handlers: [
    http.get(`/api/audiobooks/${CONVERSION_ID}`, () =>
      HttpResponse.json(
        {
          error: {
            requestId: "09e6d824-d41d-43bb-9417-18f89232ba56",
            code: "operational-error",
            message: "The audiobook could not be loaded.",
          },
        } satisfies ErrorResponse,
        { status: 500 },
      ),
    ),
  ],
} satisfies Story;

function createReadySegment(sequence: number) {
  return {
    sequence,
    status: "ready" as const,
    durationMilliseconds: 5000,
    url: `https://example.com/segments/${sequence}/audio.mp3`,
  };
}

const PREPARED_AUDIOBOOK = {
  canGenerate: true,
  playbackPosition: null,
  title: "A deterministic document about careful testing",
  originalUrl: SOURCE_URL,
  narrationDocument: {
    html: '<article><h1 id="unit-1">A deterministic document about careful testing</h1><p id="unit-2">Keep the important boundaries real.</p><p id="unit-3">Replace only what you cannot control.</p></article>',
    synchronizationUnits: [
      { id: "unit-1", narrationText: "A deterministic document about careful testing" },
      { id: "unit-2", narrationText: "Keep the important boundaries real." },
      { id: "unit-3", narrationText: "Replace only what you cannot control." },
    ],
  },
};

function createAudiobook(): Audiobook {
  return {
    ...PREPARED_AUDIOBOOK,
    status: "ready",
    segments: [createReadySegment(0), createReadySegment(1), createReadySegment(2)],
  };
}

function createPreparedStory(audiobook: Audiobook) {
  return {
    component: () => <GlobalProviders router={router} />,
    handlers: [
      http.get(`/api/audiobooks/${CONVERSION_ID}`, () => HttpResponse.json(audiobook)),
      // The allowance was spent elsewhere, so a retry of the missing audio is refused.
      http.post(`/api/audiobooks/${CONVERSION_ID}/retry`, () =>
        HttpResponse.json({
          result: "insufficient-duration",
          requiredMilliseconds: 3_000,
          availableMilliseconds: 1_000,
        } satisfies RetryConversionResponse),
      ),
    ],
  } satisfies Story;
}

export const SynthesizingAudiobook = createPreparedStory({
  ...PREPARED_AUDIOBOOK,
  status: "synthesizing",
  segments: [
    createReadySegment(0),
    { sequence: 1, status: "generating" },
    { sequence: 2, status: "generating" },
  ],
});

export const InsufficientDuration = createPreparedStory({
  ...PREPARED_AUDIOBOOK,
  status: "insufficient-duration",
  requiredMilliseconds: 754_000,
  availableMilliseconds: 95_000,
  segments: [
    { sequence: 0, status: "absent" },
    { sequence: 1, status: "absent" },
    { sequence: 2, status: "absent" },
  ],
});

export const AudiobookWithoutAudio = createPreparedStory({
  ...PREPARED_AUDIOBOOK,
  status: "ready",
  segments: [0, 1, 2].map((sequence) => ({
    sequence,
    status: "failed" as const,
    explanation: "The provider is unavailable.",
  })),
});

export const AudiobookWithFailedSegment = createPreparedStory({
  ...PREPARED_AUDIOBOOK,
  status: "ready",
  segments: [
    createReadySegment(0),
    { sequence: 1, status: "failed", explanation: "The provider rejected this text." },
    createReadySegment(2),
  ],
});

export const PendingConversion = {
  component: () => <GlobalProviders router={router} />,
  handlers: [
    http.get("/api/audiobooks/" + CONVERSION_ID, () =>
      HttpResponse.json({
        status: "pending",
        originalUrl: "https://example.com/article",
        canGenerate: true,
      }),
    ),
  ],
} satisfies Story;
export const FailedConversion = {
  component: () => <GlobalProviders router={router} />,
  handlers: [
    http.get("/api/audiobooks/" + CONVERSION_ID, () =>
      HttpResponse.json({
        status: "failed",
        originalUrl: "https://example.com/article",
        canGenerate: true,
        explanation: "Preparation failed.",
      }),
    ),
  ],
} satisfies Story;
