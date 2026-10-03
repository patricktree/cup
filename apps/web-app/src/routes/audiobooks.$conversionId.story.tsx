import { createMemoryHistory } from "@tanstack/react-router";
import { http, HttpResponse } from "msw";
import React from "react";

import type { Audiobook, ErrorResponse } from "@cup/web-app-api.routes";

import { createAppRouter, GlobalProviders } from "#src/app/global-providers.js";
import type { Story } from "#src/ui-gallery/story.js";

const CONVERSION_ID = "693af4c4-9fa8-430d-9dc5-c00e88fb38a7";
const SOURCE_URL = "https://source.example.test/fixture";
const memoryHistory = createMemoryHistory({ initialEntries: [`/app/audiobooks/${CONVERSION_ID}`] });
const router = createAppRouter(memoryHistory);

export const ReadyAudiobook = {
  component: () => <GlobalProviders router={router} />,
  handlers: [
    http.get(`/api/audiobooks/${CONVERSION_ID}`, () => HttpResponse.json(createAudiobook())),
    http.get(
      `/api/files/audiobooks/${CONVERSION_ID}/audio.mp3`,
      () => new HttpResponse(null, { headers: { "Content-Type": "audio/mpeg" } }),
    ),
    http.get(
      `/api/files/audiobooks/${CONVERSION_ID}/captions.vtt`,
      () =>
        new HttpResponse(
          "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nKeep the important boundaries real.\n",
          { headers: { "Content-Type": "text/vtt" } },
        ),
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

function createAudiobook(): Audiobook {
  return {
    title: "A deterministic document about careful testing",
    originalUrl: SOURCE_URL,
    narrationDocument: {
      html: "<p>Keep the important boundaries real.</p>",
      synchronizationUnits: [
        { id: "unit-1", narrationText: "Keep the important boundaries real." },
      ],
    },
    synchronizationCues: [
      { synchronizationUnitId: "unit-1", startMilliseconds: 0, endMilliseconds: 1_000 },
    ],
    audio: {
      contentType: "audio/mpeg",
      url: `${window.location.origin}/api/files/audiobooks/${CONVERSION_ID}/audio.mp3`,
    },
    captions: {
      contentType: "text/vtt",
      url: `${window.location.origin}/api/files/audiobooks/${CONVERSION_ID}/captions.vtt`,
    },
    epub: {
      contentType: "application/epub+zip",
      url: `${window.location.origin}/api/files/audiobooks/${CONVERSION_ID}/book.epub`,
    },
  };
}
