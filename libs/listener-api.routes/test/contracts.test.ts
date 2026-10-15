import { describe, expect, test } from "vitest";

import {
  audiobookSchema,
  audioSegmentSchema,
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

  test("accepts prepared narration before audio exists", () => {
    const prepared = {
      status: "ready",
      canGenerate: true,
      title: "Document",
      originalUrl: "https://example.com/source",
      narrationDocument: {
        html: "<article>Document</article>",
        synchronizationUnits: [{ id: "one", narrationText: "Document" }],
      },
      segments: [{ sequence: 0, status: "absent" }],
      playbackPosition: { synchronizationUnitId: "one", offsetMilliseconds: 1500 },
    };
    expect(audiobookSchema.safeParse(prepared).success).toBe(true);
    expect(
      audiobookSchema.safeParse({ ...prepared, audio: { url: "https://example.com/audio" } })
        .success,
    ).toBe(false);
    expect(
      audiobookSchema.safeParse({
        ...prepared,
        playbackPosition: { synchronizationUnitId: "one", offsetMilliseconds: -1 },
      }).success,
    ).toBe(false);
  });

  test.each([
    { sequence: 0, status: "absent" },
    { sequence: 0, status: "generating" },
    {
      sequence: 0,
      status: "ready",
      durationMilliseconds: 1500,
      url: "https://example.com/audio.mp3",
    },
    { sequence: 0, status: "failed", explanation: "Speech generation failed." },
  ])("accepts a complete audio segment state: $status", (segment) => {
    expect(audioSegmentSchema.safeParse(segment).success).toBe(true);
  });

  test.each([
    { sequence: 0, status: "failed" },
    { sequence: 0, status: "ready", url: "https://example.com/audio.mp3" },
    { sequence: 0, status: "ready", durationMilliseconds: 1500 },
    { sequence: 0, status: "absent", explanation: "Unexpected failure" },
    { sequence: 0, status: "generating", explanation: "Unexpected failure" },
    {
      sequence: 0,
      status: "ready",
      durationMilliseconds: 1500,
      url: "https://example.com/audio.mp3",
      explanation: "Unexpected failure",
    },
    {
      sequence: 0,
      status: "failed",
      explanation: "Speech failed",
      url: "https://example.com/audio.mp3",
    },
  ])("rejects incomplete or contradictory audio segment states", (segment) => {
    expect(audioSegmentSchema.safeParse(segment).success).toBe(false);
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
