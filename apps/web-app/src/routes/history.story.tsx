import { accountStory, CONVERSION_ID } from "#ui-gallery/account-fixtures.jsx";

export const EmptyHistory = accountStory({ path: "/history" });
export const ConversionHistory = accountStory({
  path: "/history",
  history: {
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
