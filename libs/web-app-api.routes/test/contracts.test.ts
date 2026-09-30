import { describe, expect, test } from "vitest";

import {
  audiobookSchema,
  conversionParamsSchema,
  errorResponseSchema,
  exchangeCredentialRequestSchema,
  grantConversionsSchema,
  grantParamsSchema,
  grantSnapshotSchema,
  startConversionHeadersSchema,
  startConversionRequestSchema,
} from "#src/contracts.ts";

const UUID = "b4ad28a8-bbd7-46af-a17c-59527becd745";

describe("web application transport contracts", () => {
  test.each([
    [grantParamsSchema, { grantId: UUID, extra: true }],
    [conversionParamsSchema, { conversionId: UUID, extra: true }],
    [exchangeCredentialRequestSchema, { credential: `v1.${"a".repeat(43)}`, extra: true }],
    [startConversionRequestSchema, { sourceUrl: "https://example.com", extra: true }],
  ])("rejects unknown fields", (schema, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });

  test("accepts lowercase UUIDv4 only", () => {
    expect(grantParamsSchema.safeParse({ grantId: UUID }).success).toBe(true);
    expect(grantParamsSchema.safeParse({ grantId: UUID.toUpperCase() }).success).toBe(false);
    expect(conversionParamsSchema.safeParse({ conversionId: UUID }).success).toBe(true);
    expect(conversionParamsSchema.safeParse({ conversionId: UUID.toUpperCase() }).success).toBe(
      false,
    );
  });

  test("enforces credential version and exact secret length", () => {
    expect(
      exchangeCredentialRequestSchema.safeParse({ credential: `v1.${"a".repeat(43)}` }).success,
    ).toBe(true);
    expect(
      exchangeCredentialRequestSchema.safeParse({ credential: `v2.${"a".repeat(43)}` }).success,
    ).toBe(false);
  });

  test("enforces source URL limits and embedded-credential prohibition", () => {
    expect(
      startConversionRequestSchema.safeParse({
        sourceUrl: `https://example.com/${"a".repeat(2_100)}`,
      }).success,
    ).toBe(false);
    expect(
      startConversionRequestSchema.safeParse({ sourceUrl: "https://user:secret@example.com" })
        .success,
    ).toBe(false);
  });

  test("requires fixed browser headers and an idempotency UUID", () => {
    expect(
      startConversionHeadersSchema.safeParse({
        "content-type": "application/json",
        "x-create-audiobook-from-url-request": "1",
        "idempotency-key": UUID,
      }).success,
    ).toBe(true);
    expect(
      startConversionHeadersSchema.safeParse({
        "content-type": "application/json; charset=utf-8",
        "x-create-audiobook-from-url-request": "1",
        "idempotency-key": UUID,
      }).success,
    ).toBe(false);
  });

  test("requires stable error envelopes", () => {
    expect(
      errorResponseSchema.safeParse({
        error: { code: "grant-expired", message: "Expired.", requestId: UUID },
      }).success,
    ).toBe(true);
    expect(
      errorResponseSchema.safeParse({
        error: { code: "GrantExpired", message: "Expired.", requestId: UUID },
      }).success,
    ).toBe(false);
  });

  test("fixes web audiobook media content types", () => {
    const result = audiobookSchema.safeParse({
      title: "Document",
      originalUrl: "https://example.com/source",
      narrationDocument: {
        html: "<article>Document</article>",
        synchronizationUnits: [{ id: "one", narrationText: "Document" }],
      },
      synchronizationCues: [
        { synchronizationUnitId: "one", startMilliseconds: 0, endMilliseconds: 1 },
      ],
      audio: { contentType: "audio/wav", url: "https://example.com/audio" },
      captions: { contentType: "text/vtt", url: "https://example.com/captions" },
      epub: { contentType: "application/epub+zip", url: "https://example.com/book" },
    });
    expect(result.success).toBe(false);
  });

  test("keeps conversions separate from the grant snapshot", () => {
    expect(
      grantSnapshotSchema.safeParse({
        grantId: UUID,
        createdAt: "2026-08-28T12:00:00.000Z",
        expiresAt: "2026-08-29T12:00:00.000Z",
        state: "open",
        duration: { availableMilliseconds: 4, reservedMilliseconds: 0, spentMilliseconds: 1 },
      }).success,
    ).toBe(true);
    expect(
      grantSnapshotSchema.safeParse({
        grantId: UUID,
        createdAt: "2026-08-28T12:00:00.000Z",
        expiresAt: "2026-08-29T12:00:00.000Z",
        state: "open",
        duration: { availableMilliseconds: 4, reservedMilliseconds: 0, spentMilliseconds: 1 },
        conversions: [],
      }).success,
    ).toBe(false);
  });

  test("accepts the application-relative route of a ready audiobook conversion", () => {
    expect(
      grantConversionsSchema.safeParse([
        {
          conversionId: UUID,
          sourceUrl: "https://example.com/source",
          title: "Document",
          acceptedAt: "2026-08-28T12:00:00.000Z",
          completedAt: "2026-08-28T12:01:00.000Z",
          status: "ready",
          audiobookUrl: `/app/audiobooks/${UUID}`,
        },
      ]).success,
    ).toBe(true);
  });
});
