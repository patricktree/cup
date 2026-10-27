import { createMemoryHistory } from "@tanstack/react-router";
import { delay, http, HttpResponse } from "msw";
import React from "react";

import type {
  Audiobook,
  ErrorResponse,
  PreparationPhase,
  RetryConversionResponse,
} from "@cup/listener-api.routes";

import { createAppRouter, GlobalProviders } from "#src/app/global-providers.js";
import { queryClient } from "#src/data-fetching/query-client.js";
import { createAudiobookQuery } from "#src/data-fetching/reader.js";
import { accountStory } from "#src/ui-gallery/account-fixtures.jsx";
import gatesNotesAudiobook from "#src/ui-gallery/gates-notes-audiobook.json" with { type: "json" };
import {
  createStoryNarrationTrack,
  storyNarrationTrackHandler,
} from "#src/ui-gallery/narration-track.js";
import type { Story } from "#src/ui-gallery/story.js";

const CONVERSION_ID = "693af4c4-9fa8-430d-9dc5-c00e88fb38a7";
const SOURCE_URL = "https://source.example.test/fixture";
const SEGMENT_DURATION_MILLISECONDS = 5_000;
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
    storyNarrationTrackHandler,
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
        narrationTrack: createStoryNarrationTrack(
          gatesNotesAudiobook.narrationDocument.synchronizationUnits.map(
            () => SEGMENT_DURATION_MILLISECONDS,
          ),
        ),
      } satisfies Audiobook),
    ),
    storyNarrationTrackHandler,
  ],
} satisfies Story;

const COVER_URL = `${window.location.origin}/__story/covers/detail.svg`;

/** A signed-in listener opens a long audiobook with a cover. */
export const AccountAudiobook = accountStory({
  path: `/audiobooks/${GATES_NOTES_CONVERSION_ID}`,
  handlers: [
    http.get(`/api/audiobooks/${GATES_NOTES_CONVERSION_ID}`, () =>
      HttpResponse.json({
        ...gatesNotesAudiobook,
        status: "ready",
        coverImage: { url: COVER_URL, alternativeText: "A person reading by a window" },
        segments: gatesNotesAudiobook.narrationDocument.synchronizationUnits.map(
          (_unit, sequence) => createReadySegment(sequence),
        ),
        narrationTrack: createStoryNarrationTrack(
          gatesNotesAudiobook.narrationDocument.synchronizationUnits.map(
            () => SEGMENT_DURATION_MILLISECONDS,
          ),
        ),
      } satisfies Audiobook),
    ),
    http.get(
      COVER_URL,
      () =>
        new HttpResponse(
          '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#5b7f95"/><circle cx="200" cy="100" r="60" fill="#fff"/></svg>',
          { headers: { "Content-Type": "image/svg+xml" } },
        ),
    ),
    storyNarrationTrackHandler,
    http.put(
      `/api/audiobooks/${GATES_NOTES_CONVERSION_ID}/position`,
      () => new HttpResponse(null, { status: 204 }),
    ),
    http.post(`/api/audiobooks/${GATES_NOTES_CONVERSION_ID}/retry`, () =>
      HttpResponse.json({ result: "started" } satisfies RetryConversionResponse),
    ),
  ],
});

/** The first response never arrives. */
export const LoadingAudiobook = {
  component: () => <GlobalProviders router={router} />,
  handlers: [
    http.get(`/api/audiobooks/${CONVERSION_ID}`, async () => {
      await delay("infinite");
    }),
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

const SECOND_CONVERSION_ID = "c4be3f43-4a43-4d6b-9a3f-6f0d2f6e2d51";

/** A signed-in listener moves between an audiobook, Recents, and a second audiobook. */
export const ListeningAcrossPages = accountStory({
  path: `/audiobooks/${CONVERSION_ID}`,
  recents: {
    items: [
      createRecentsItem(CONVERSION_ID, "A deterministic document about careful testing"),
      createRecentsItem(SECOND_CONVERSION_ID, "A second document about listening"),
    ],
    nextCursor: null,
  },
  handlers: [
    http.get(`/api/audiobooks/${CONVERSION_ID}`, () => HttpResponse.json(createAudiobook())),
    http.get(`/api/audiobooks/${SECOND_CONVERSION_ID}`, () =>
      HttpResponse.json({
        ...PREPARED_AUDIOBOOK,
        status: "ready",
        title: "A second document about listening",
        segments: [0, 1, 2].map(createReadySegment),
        narrationTrack: createStoryNarrationTrack(
          [
            SEGMENT_DURATION_MILLISECONDS,
            SEGMENT_DURATION_MILLISECONDS,
            SEGMENT_DURATION_MILLISECONDS,
          ],
          "second",
        ),
      } satisfies Audiobook),
    ),
    storyNarrationTrackHandler,
    http.put(
      "/api/audiobooks/:conversionId/position",
      () => new HttpResponse(null, { status: 204 }),
    ),
  ],
});

function createRecentsItem(conversionId: string, title: string) {
  return {
    conversionId,
    sourceUrl: SOURCE_URL,
    createdAtMs: 0,
    idempotencyKey: conversionId,
    status: "ready",
    outcome: { status: "ready", title },
  };
}

function createReadySegment(sequence: number) {
  return { sequence, status: "ready" as const };
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
    narrationTrack: createStoryNarrationTrack([
      SEGMENT_DURATION_MILLISECONDS,
      SEGMENT_DURATION_MILLISECONDS,
      SEGMENT_DURATION_MILLISECONDS,
    ]),
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

/** The audiobook offers no retry, such as once a trial no longer permits speech generation. */
export const AudiobookWithoutRetry = createPreparedStory({
  ...createAudiobook(),
  canGenerate: false,
});

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

function createPendingStory(preparationPhase?: PreparationPhase) {
  return {
    component: () => <GlobalProviders router={router} />,
    handlers: [
      http.get(`/api/audiobooks/${CONVERSION_ID}`, () =>
        HttpResponse.json({
          status: "pending",
          originalUrl: "https://example.com/article",
          canGenerate: true,
          ...(preparationPhase && { preparationPhase }),
        } satisfies Audiobook),
      ),
    ],
  } satisfies Story;
}

/** A conversion whose phase is not reported, or not known to this client. */
export const PendingConversion = createPendingStory();
export const PendingStarting = createPendingStory("starting");
export const PendingReadingPage = createPendingStory("reading-page");
export const PendingSelectingContent = createPendingStory("selecting-content");
export const PendingPreparingText = createPendingStory("preparing-text");

export const FailedConversion = {
  component: () => <GlobalProviders router={router} />,
  handlers: [
    http.get("/api/audiobooks/" + CONVERSION_ID, () =>
      HttpResponse.json({
        status: "failed",
        originalUrl: "https://www.example.com/article",
        canGenerate: true,
        explanation: "Preparation failed. Retry to load this track.",
      }),
    ),
  ],
} satisfies Story;

export const RetryRefused = {
  component: () => <GlobalProviders router={router} />,
  handlers: [
    http.get(`/api/audiobooks/${CONVERSION_ID}`, () =>
      HttpResponse.json({
        ...PREPARED_AUDIOBOOK,
        status: "ready",
        segments: [0, 1, 2].map((sequence) => ({
          sequence,
          status: "failed" as const,
          explanation: "The provider is unavailable.",
        })),
      } satisfies Audiobook),
    ),
    http.post(`/api/audiobooks/${CONVERSION_ID}/retry`, () =>
      HttpResponse.json(
        {
          error: {
            requestId: "09e6d824-d41d-43bb-9417-18f89232ba56",
            code: "grant-expired",
            message: "This trial no longer permits new speech generation.",
          },
        } satisfies ErrorResponse,
        { status: 403 },
      ),
    ),
  ],
} satisfies Story;

/**
 * Polling an audiobook whose audio is generated fails three times, then recovers. The count spans
 * the page's lifetime, so the failures play out only once per page load.
 */
export const PollingInterrupted = {
  component: () => <GlobalProviders router={router} />,
  handlers: (() => {
    let requestCount = 0;
    return [
      http.get(`/api/audiobooks/${CONVERSION_ID}`, () => {
        requestCount += 1;
        if (requestCount >= 2 && requestCount <= 4) {
          return HttpResponse.json(
            {
              error: {
                requestId: "09e6d824-d41d-43bb-9417-18f89232ba56",
                code: "operational-error",
                message: "The audiobook could not be loaded.",
              },
            } satisfies ErrorResponse,
            { status: 500 },
          );
        }
        return HttpResponse.json({
          ...PREPARED_AUDIOBOOK,
          status: "synthesizing",
          segments: [
            createReadySegment(0),
            { sequence: 1, status: "generating" },
            { sequence: 2, status: "generating" },
          ],
        } satisfies Audiobook);
      }),
    ];
  })(),
} satisfies Story;
