/*
 * PROTOTYPE, throwaway (#148): the real app at Recents, with every API request delayed by the
 * prototype panel's network delay. See `src/app/pending-prototype/pending-prototype.tsx`.
 */
import { createMemoryHistory } from "@tanstack/react-router";
import { delay, http, HttpResponse } from "msw";
import React from "react";

import type { Audiobook } from "@cup/listener-api.routes";

import { createAppRouter, GlobalProviders } from "#src/app/global-providers.js";
import { prototypeSettings, PrototypePanel } from "#src/app/pending-prototype/pending-prototype.js";
import { ACCOUNT_SESSION_STORAGE_KEY } from "#src/auth/account-session-storage.js";
import gatesNotesAudiobook from "#src/ui-gallery/gates-notes-audiobook.json" with { type: "json" };
import {
  createStoryNarrationTrack,
  storyNarrationTrackHandler,
} from "#src/ui-gallery/narration-track.js";
import type { Story } from "#src/ui-gallery/story.js";

const SUBJECT = "880ce5b5-6542-40fd-8f2d-380f3066e98a";
const COVER_PATH = "/__story/covers";
const TITLES = [
  "Our minds aren’t equipped to handle AI",
  "China resumes curbs on Fuel Exports",
  "A quiet revolution in battery chemistry",
  "Why the night sky is getting brighter, and what astronomers can still do about it",
  "The last lighthouse keepers",
  "Inside the race to map every protein",
  "Trump is getting desperate",
  "Midterms are ahead in the U.S.",
];
const HOSTS = ["derstandard.at", "www.theverge.com", "nytimes.com"];
const COVER_COLORS = ["5b7f95", "c4733d", "7a8f4e", "8a5a83"];

function conversionIdOf(index: number) {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}
function indexOf(conversionId: string) {
  return Number(conversionId.slice(-12)) - 1;
}

function PendingPrototypeApp(): React.ReactNode {
  const [router] = React.useState(() =>
    createAppRouter(createMemoryHistory({ initialEntries: [`/app${prototypeSettings.start}`] })),
  );
  return (
    <>
      <GlobalProviders router={router} />
      <PrototypePanel />
    </>
  );
}

export const PendingPrototype = {
  // Stores a session without waiting for auth, so the cold start restores it as the app does.
  beforeMount: async () => {
    const payload = btoa(JSON.stringify({ sub: SUBJECT, exp: 4102444800 })).replaceAll("=", "");
    localStorage.setItem(
      ACCOUNT_SESSION_STORAGE_KEY,
      JSON.stringify({
        access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.fixture`,
        refresh_token: "story-refresh",
        token_type: "bearer",
        expires_at: 4102444800,
        expires_in: 300,
        user: {
          id: SUBJECT,
          email: "reader@example.test",
          user_metadata: { name: "Verena Handler-Kunze" },
        },
      }),
    );
  },
  component: PendingPrototypeApp,
  handlers: [
    // Every API request waits for the network delay, then falls through to its handler below.
    http.all("/api/*", async () => {
      await delay(prototypeSettings.delayMs);
    }),
    http.get("/api/auth/config", () =>
      HttpResponse.json({
        supabaseUrl: window.location.origin + "/__story",
        publishableKey: "story-key",
        googleWebClientId: "story-client",
      }),
    ),
    http.get("/api/account", () =>
      HttpResponse.json({
        accountId: "70fcf2d9-63c5-48be-b897-d3670f24ed43",
        createdAtMs: 0,
        subject: SUBJECT,
        state: "active",
        executionEpoch: 1,
        recoveryDeadlineMs: null,
        balance: { unit: "audio-millisecond", available: 1_800_000, reserved: 0 },
      }),
    ),
    http.get("/api/account/conversions", () =>
      HttpResponse.json({
        items: Array.from({ length: 16 }, (_, index) => ({
          conversionId: conversionIdOf(index),
          idempotencyKey: conversionIdOf(index),
          sourceUrl: `https://${HOSTS[index % HOSTS.length]}/articles/${index}`,
          createdAtMs: 0,
          status: "ready",
          outcome: {
            status: "ready",
            title: TITLES[index % TITLES.length],
            ...(index % 4 !== 3 && {
              hasCoverImage: true,
              coverImage: {
                url: `${window.location.origin}${COVER_PATH}/${COVER_COLORS[index % COVER_COLORS.length]}.svg`,
              },
            }),
          },
        })),
        nextCursor: null,
      }),
    ),
    http.get("/api/audiobooks/:conversionId", ({ params }) => {
      const index = indexOf(String(params["conversionId"]));
      return HttpResponse.json({
        ...gatesNotesAudiobook,
        title: TITLES[index % TITLES.length] ?? gatesNotesAudiobook.title,
        status: "ready",
        ...(index % 4 !== 3 && {
          coverImage: {
            url: `${window.location.origin}${COVER_PATH}/${COVER_COLORS[index % COVER_COLORS.length]}.svg`,
            alternativeText: "A flat-colored cover",
          },
        }),
        segments: gatesNotesAudiobook.narrationDocument.synchronizationUnits.map((_unit, sequence) => ({
          sequence,
          status: "ready" as const,
        })),
        narrationTrack: createStoryNarrationTrack(
          gatesNotesAudiobook.narrationDocument.synchronizationUnits.map(() => 5_000),
        ),
      } satisfies Audiobook);
    }),
    http.put("/api/audiobooks/:conversionId/position", () => new HttpResponse(null, { status: 204 })),
    http.get(`${COVER_PATH}/:color`, ({ params }) => {
      const color = `#${String(params["color"]).replace(/\.svg$/, "")}`;
      return new HttpResponse(
        `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="${color}"/><circle cx="200" cy="100" r="60" fill="#fff"/></svg>`,
        { headers: { "Content-Type": "image/svg+xml" } },
      );
    }),
    storyNarrationTrackHandler,
  ],
} satisfies Story;
