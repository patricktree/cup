import { createMemoryHistory } from "@tanstack/react-router";
import { http, HttpResponse } from "msw";
import React from "react";

import type { Audiobook, ErrorResponse } from "@cup/web-app-api.routes";

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
    http.post(`/api/audiobooks/${CONVERSION_ID}/segments/0`, () =>
      HttpResponse.json({
        sequence: 0,
        status: "ready",
        durationMilliseconds: 5000,
        url: `https://example.com/segments/0/audio.mp3`,
      }),
    ),
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
      HttpResponse.json({ ...gatesNotesAudiobook, status: "ready" } satisfies Audiobook),
    ),
    http.post(`/api/audiobooks/${GATES_NOTES_CONVERSION_ID}/segments/:sequence`, ({ params }) => {
      const sequence = Number(params["sequence"]);

      return HttpResponse.json({
        sequence,
        status: "ready",
        durationMilliseconds: 5000,
        url: `https://example.com/segments/${sequence}/audio.mp3`,
      });
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

function createAudiobook(): Audiobook {
  return {
    status: "ready",
    canGenerate: true,
    playbackPosition: null,
    segments: [],
    title: "A deterministic document about careful testing",
    originalUrl: SOURCE_URL,
    narrationDocument: {
      html: '<h1>A deterministic document about careful testing</h1><p id="unit-1">Keep the important boundaries real.</p>',
      synchronizationUnits: [
        { id: "unit-1", narrationText: "Keep the important boundaries real." },
      ],
    },
  };
}

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
