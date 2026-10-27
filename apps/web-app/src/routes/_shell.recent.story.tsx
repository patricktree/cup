import { waitFor, within } from "@testing-library/dom";
import { userEvent } from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";

import { accountStory, CONVERSION_ID } from "#src/ui-gallery/account-fixtures.jsx";
import type { Story } from "#src/ui-gallery/story.js";

const ADDED_CONVERSION_ID = "c1d0f6a2-3b4e-4f5a-8b6c-7d8e9f0a1b2c";
const ADDED_SOURCE_URL = "https://example.test/added";

export const EmptyRecents = accountStory({ path: "/recent" });
/** The session carries no name, so the avatar shows its glyph. */
export const RecentsWithoutName = accountStory({ path: "/recent", userMetadata: {} });
/** A signed-in listener opening the home page lands on Recents. */
export const SignedInHome = accountStory({ path: "/" });
export const Recents = accountStory({
  path: "/recent",
  recents: {
    items: [
      {
        conversionId: CONVERSION_ID,
        sourceUrl: "https://example.test/article",
        createdAtMs: 0,
        idempotencyKey: CONVERSION_ID,
        status: "ready",
        outcome: { status: "ready", title: "A private audiobook" },
      },
      {
        conversionId: "a3fcb5d8-9162-4c1a-b804-3be130c5e92a",
        sourceUrl: "https://example.test/pending",
        createdAtMs: 0,
        idempotencyKey: CONVERSION_ID,
        status: "pending",
        outcome: null,
      },
      {
        conversionId: "70fcf2d9-63c5-48be-b897-d3670f24ed43",
        sourceUrl: "https://example.test/failed",
        createdAtMs: 0,
        idempotencyKey: CONVERSION_ID,
        status: "failed",
        outcome: {
          status: "failed",
          explanation: "Audio production failed.",
        },
      },
    ],
    nextCursor: "next-page",
  },
});

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
          items: isStarted
            ? [
                {
                  conversionId: ADDED_CONVERSION_ID,
                  sourceUrl: ADDED_SOURCE_URL,
                  createdAtMs: 0,
                  idempotencyKey: ADDED_CONVERSION_ID,
                  status: "pending",
                  outcome: null,
                },
              ]
            : [],
          nextCursor: null,
        }),
      ),
    ],
  });
})();

async function submitSourceUrl({ canvasElement }: Parameters<NonNullable<Story["play"]>>[0]) {
  const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog"));
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
