import { waitFor, within } from "@testing-library/dom";
import { userEvent } from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";

import type { Audiobook } from "@cup/listener-api.routes";

import { accountStory } from "#src/ui-gallery/account-fixtures.jsx";
import {
  createStoryNarrationTrack,
  storyNarrationTrackHandler,
} from "#src/ui-gallery/narration-track.js";
import type { Story } from "#src/ui-gallery/story.js";

const ADDED_CONVERSION_ID = "c1d0f6a2-3b4e-4f5a-8b6c-7d8e9f0a1b2c";
const ADDED_SOURCE_URL = "https://example.test/added";

const COVER_PATH = "/__story/covers";
const SECOND_PAGE_CURSOR = "second-page";

/** Titles of different lengths, so the cards differ in height. */
const TITLES = [
  "Trump sieht sich als legitimer Träger von acht Nobelpreisen und wütet gegen Norwegen",
  "Our minds aren’t equipped to handle AI",
  "China resumes curbs on Fuel Exports",
  "Todeskandidatin Christa Pike aus Krankenhaus in Gefängnis verlegt",
  "Bürgermeister in Peru heißt Hitler Mussolini Simeón",
  "Trump is getting desperate",
  "George A. Romero’s Season of the Witch is a slow-burn feminist occult drama",
  "Midterms are ahead in the U.S.",
  "A quiet revolution in battery chemistry",
  "Why the night sky is getting brighter, and what astronomers can still do about it",
  "The last lighthouse keepers",
  "Inside the race to map every protein",
];
const HOSTS = ["derstandard.at", "www.theverge.com", "nytimes.com"];
const COVER_COLORS = ["#5b7f95", "#c4733d", "#7a8f4e", "#8a5a83"];

export const EmptyRecents = accountStory({ path: "/recent" });
/** The history never answers, so Recents keeps loading its tracks. */
export const LoadingTracks = accountStory({
  path: "/recent",
  handlers: [http.get("/api/account/conversions", () => delay("infinite"))],
});
/** The session carries no name, so the avatar shows its glyph. */
export const RecentsWithoutName = accountStory({ path: "/recent", userMetadata: {} });
/** A signed-in listener opening the home page lands on Recents. */
export const SignedInHome = accountStory({ path: "/" });

/** Two pages of ready cards, most of them with a cover; the second page loads on scrolling. */
export const Recents = accountStory({
  path: "/recent",
  handlers: [
    coverHandler(),
    http.get("/api/account/conversions", ({ request }) => {
      const isSecondPage = new URL(request.url).searchParams.get("cursor") === SECOND_PAGE_CURSOR;
      return HttpResponse.json(
        isSecondPage
          ? { items: createReadyItems(24, 12), nextCursor: null }
          : { items: createReadyItems(0, 24), nextCursor: SECOND_PAGE_CURSOR },
      );
    }),
  ],
});

export const RecentsWithOneReadyItem = accountStory({
  path: "/recent",
  handlers: [coverHandler()],
  recents: { items: createReadyItems(0, 1), nextCursor: null },
});

/** A pending card for each preparation phase label, next to ready and failed cards. */
export const RecentsWithPendingAndFailed = accountStory({
  path: "/recent",
  handlers: [coverHandler()],
  recents: {
    items: [
      historyItem(0, { status: "pending", preparationPhase: "selecting-content", outcome: null }),
      historyItem(1, { status: "pending", outcome: null }),
      ...createReadyItems(2, 1),
      historyItem(3, {
        status: "failed",
        outcome: { status: "failed", explanation: "Preparation failed." },
      }),
      historyItem(4, {
        status: "synthesizing",
        outcome: { status: "ready", title: "Generating audio still looks ready" },
      }),
    ],
    nextCursor: null,
  },
});

const LOADED_CONVERSION_ID = "5f0c8a52-2d3e-4b8f-9a61-0c7e4d2b9f13";
const LOADED_TITLE = "Sure, let’s smoosh SpaceX and xAI together";

/**
 * The listener loaded an audiobook on its detail view and went back to Recents, where one track is
 * pending, as drawn.
 */
export const RecentsWithMiniPlayer = createMiniPlayerStory({ hasCover: true });
export const RecentsWithMiniPlayerWithoutCover = createMiniPlayerStory({ hasCover: false });

function createMiniPlayerStory({ hasCover }: { hasCover: boolean }): Story {
  return accountStory({
    path: `/audiobooks/${LOADED_CONVERSION_ID}`,
    recents: {
      items: [
        historyItem(0, { status: "pending", preparationPhase: "selecting-content", outcome: null }),
      ],
      nextCursor: null,
    },
    handlers: [
      coverHandler(),
      http.get(`/api/audiobooks/${LOADED_CONVERSION_ID}`, () =>
        HttpResponse.json({
          status: "ready",
          canGenerate: true,
          playbackPosition: null,
          title: LOADED_TITLE,
          originalUrl: "https://www.theverge.com/articles/smoosh",
          ...(hasCover && {
            coverImage: { url: `${window.location.origin}${COVER_PATH}/c4733d.svg` },
          }),
          narrationDocument: {
            html: `<article><h1 id="unit-1">${LOADED_TITLE}</h1><p id="unit-2">Two.</p></article>`,
            synchronizationUnits: [
              { id: "unit-1", narrationText: LOADED_TITLE },
              { id: "unit-2", narrationText: "Two." },
            ],
          },
          segments: [
            { sequence: 0, status: "ready" },
            { sequence: 1, status: "ready" },
          ],
          narrationTrack: createStoryNarrationTrack([30_000, 30_000]),
        } satisfies Audiobook),
      ),
      storyNarrationTrackHandler,
      http.put(
        `/api/audiobooks/${LOADED_CONVERSION_ID}/position`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    ],
    play: goBackToRecentsOnceLoaded,
  });
}

/**
 * The player sheet's scrubber is enabled once the audiobook can play; with nothing loaded, the
 * player host loads it at the same moment.
 */
async function goBackToRecentsOnceLoaded({
  canvasElement,
}: Parameters<NonNullable<Story["play"]>>[0]) {
  const canvas = within(canvasElement);
  // The loading view's disabled sheet is replaced once the audiobook arrives, so query each time.
  await waitFor(
    () => {
      const position = canvas.getByRole("slider", { name: /^Position in / });
      if (!(position instanceof HTMLInputElement) || position.disabled) {
        throw new Error("The player sheet is still disabled.");
      }
    },
    { timeout: 10_000 },
  );
  await userEvent.setup().click(canvas.getByRole("link", { name: "Back" }));
  await canvas.findByRole("region", { name: "Player" }, { timeout: 10_000 });
}

/** A stable conversion ID per generated history item. */
function toStoryConversionId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function createReadyItems(firstIndex: number, count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, offset) => {
    const index = firstIndex + offset;
    // every fourth card has no cover
    const hasCoverImage = index % 4 !== 3;
    return historyItem(index, {
      status: "ready",
      outcome: {
        status: "ready",
        title: TITLES[index % TITLES.length],
        ...(hasCoverImage && {
          hasCoverImage,
          coverImage: {
            url: `${window.location.origin}${COVER_PATH}/${COVER_COLORS[index % COVER_COLORS.length]?.slice(1)}.svg`,
          },
        }),
      },
    });
  });
}

function historyItem(index: number, fields: Record<string, unknown>): Record<string, unknown> {
  const conversionId = toStoryConversionId(index);
  return {
    conversionId,
    idempotencyKey: conversionId,
    sourceUrl: `https://${HOSTS[index % HOSTS.length]}/articles/${index}`,
    createdAtMs: 0,
    ...fields,
  };
}

/** Flat-colored covers wider than 5:3, named by their hex color. */
function coverHandler() {
  return http.get(`${COVER_PATH}/:color`, ({ params }) => {
    const color = `#${String(params["color"]).replace(/\.svg$/, "")}`;
    return new HttpResponse(
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="${color}"/><circle cx="200" cy="100" r="60" fill="#fff"/></svg>`,
      { headers: { "Content-Type": "image/svg+xml" } },
    );
  });
}

export const AddDialog = accountStory({ path: "/recent/add" });

/** The start request never answers, so the submit button keeps its loading state. */
export const AddDialogPending = accountStory({
  path: "/recent/add",
  handlers: [http.post("/api/account/conversions", () => delay("infinite"))],
  play: submitSourceUrl,
});

export const AddDialogError = accountStory({
  path: "/recent/add",
  handlers: [
    http.post("/api/account/conversions", () =>
      HttpResponse.json({ error: { message: "This page cannot be converted." } }, { status: 422 }),
    ),
  ],
  play: submitSourceUrl,
});

/** Recents lists the started conversion once the history query is fetched again. */
export const AddDialogStarts = (() => {
  let isStarted = false;
  return accountStory({
    path: "/recent",
    handlers: [
      http.post("/api/account/conversions", () => {
        isStarted = true;
        return HttpResponse.json({ conversionId: ADDED_CONVERSION_ID }, { status: 202 });
      }),
      http.get("/api/account/conversions", () =>
        HttpResponse.json({
          items: isStarted ? [createAddedItem()] : [],
          nextCursor: null,
        }),
      ),
    ],
  });
})();

function createAddedItem() {
  return {
    conversionId: ADDED_CONVERSION_ID,
    sourceUrl: ADDED_SOURCE_URL,
    createdAtMs: 0,
    idempotencyKey: ADDED_CONVERSION_ID,
    status: "pending",
    outcome: null,
  };
}

/** The start request answers only once the page calls `window.answerAddDialogStart()`. */
export const AddDialogStartsLater = (() => {
  let isStarted = false;
  return accountStory({
    path: "/recent",
    handlers: [
      http.post("/api/account/conversions", async () => {
        await new Promise((resolve) => {
          Object.assign(window, { answerAddDialogStart: resolve });
        });
        isStarted = true;
        return HttpResponse.json({ conversionId: ADDED_CONVERSION_ID }, { status: 202 });
      }),
      http.get("/api/account/conversions", () =>
        HttpResponse.json({
          items: isStarted ? [createAddedItem()] : [],
          nextCursor: null,
        }),
      ),
    ],
  });
})();

async function submitSourceUrl({ canvasElement }: Parameters<NonNullable<Story["play"]>>[0]) {
  // The router renders nothing until the route chunks have loaded, which under a full parallel test
  // run can take longer than the lookup's default second.
  const dialog = within(
    await within(canvasElement.ownerDocument.body).findByRole("dialog", {}, { timeout: 10_000 }),
  );
  const user = userEvent.setup();
  const input = await dialog.findByRole("textbox", { name: "URL" });
  await user.type(input, ADDED_SOURCE_URL);

  const submit = dialog.getByRole("button", { name: "Add" });
  await waitFor(() => {
    if (submit.matches(":disabled")) {
      throw new Error("Waiting for the signed-in account");
    }
  });
  await user.click(submit);
}
