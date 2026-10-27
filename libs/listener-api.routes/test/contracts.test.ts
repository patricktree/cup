import { describe, expect, test } from "vitest";

import {
  accountConfirmationSchema,
  accountHistorySchema,
  accountSnapshotSchema,
  audiobookSchema,
  audioSegmentSchema,
  conversionParamsSchema,
  errorResponseSchema,
  exchangeCredentialRequestSchema,
  grantConversionsSchema,
  grantParamsSchema,
  grantSnapshotSchema,
  playbackPositionSchema,
  retryConversionResponseSchema,
  segmentParamsSchema,
  startConversionHeadersSchema,
  startConversionRequestSchema,
  startConversionResponseSchema,
} from "#src/contracts.ts";

const UUID = "b4ad28a8-bbd7-46af-a17c-59527becd745";
const ACCEPTED_AT = "2026-08-28T12:00:00.000Z";
const DURATION = { availableMilliseconds: 4, reservedMilliseconds: 0, spentMilliseconds: 1 };
const ACCOUNT_SNAPSHOT = {
  accountId: UUID,
  subject: UUID,
  createdAtMs: 1,
  state: "active",
  executionEpoch: 1,
  recoveryDeadlineMs: null,
  balance: { unit: "audio-millisecond", available: 4, reserved: 0 },
};
const PREPARED_AUDIOBOOK = {
  status: "ready",
  canGenerate: true,
  title: "Document",
  originalUrl: "https://example.com/source",
  coverImage: {
    url: "https://example.com/cover-image?token=v1.payload.signature",
    alternativeText: "Cover",
  },
  narrationDocument: {
    html: "<article>Document</article>",
    synchronizationUnits: [{ id: "one", narrationText: "Document" }],
  },
  segments: [{ sequence: 0, status: "absent" }],
  playbackPosition: { synchronizationUnitId: "one", offsetMilliseconds: 1500 },
};

describe("listener API transport contracts", () => {
  test.each([
    { name: "grant parameters", schema: grantParamsSchema, request: { grantId: UUID } },
    {
      name: "conversion parameters",
      schema: conversionParamsSchema,
      request: { conversionId: UUID },
    },
    {
      name: "segment parameters",
      schema: segmentParamsSchema,
      request: { conversionId: UUID, sequence: 0 },
    },
    {
      name: "credential exchange",
      schema: exchangeCredentialRequestSchema,
      request: { credential: `v1.${"a".repeat(43)}` },
    },
    {
      name: "start conversion",
      schema: startConversionRequestSchema,
      request: { sourceUrl: "https://example.com" },
    },
    {
      name: "account confirmation",
      schema: accountConfirmationSchema,
      request: { challengeId: UUID },
    },
    {
      name: "playback position",
      schema: playbackPositionSchema,
      request: { synchronizationUnitId: "one", offsetMilliseconds: 0 },
    },
  ])("drops unknown fields in the $name request", ({ schema, request }) => {
    const result = schema.safeParse({ ...request, extra: true });
    expect(result.success).toBe(true);
    expect(result.data).toStrictEqual(request);
  });

  test.each([
    [grantParamsSchema, { extra: true }],
    [segmentParamsSchema, { conversionId: UUID }],
    [exchangeCredentialRequestSchema, { extra: true }],
    [startConversionRequestSchema, { extra: true }],
    [accountConfirmationSchema, { providerToken: "token" }],
    [playbackPositionSchema, { synchronizationUnitId: "one" }],
  ])("still requires declared request fields", (schema, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });

  // Installed apps keep running older clients against newer Workers.
  test.each([
    {
      name: "audiobook",
      schema: audiobookSchema,
      response: {
        ...PREPARED_AUDIOBOOK,
        newField: true,
        coverImage: { ...PREPARED_AUDIOBOOK.coverImage, newField: true },
        narrationDocument: {
          ...PREPARED_AUDIOBOOK.narrationDocument,
          newField: true,
          synchronizationUnits: [{ id: "one", narrationText: "Document", newField: true }],
        },
        segments: [{ sequence: 0, status: "absent", newField: true }],
        playbackPosition: { ...PREPARED_AUDIOBOOK.playbackPosition, newField: true },
      },
      expected: PREPARED_AUDIOBOOK,
    },
    {
      name: "grant snapshot",
      schema: grantSnapshotSchema,
      response: {
        grantId: UUID,
        createdAt: ACCEPTED_AT,
        expiresAt: ACCEPTED_AT,
        state: "open",
        duration: { ...DURATION, newField: true },
        newField: true,
      },
      expected: {
        grantId: UUID,
        createdAt: ACCEPTED_AT,
        expiresAt: ACCEPTED_AT,
        state: "open",
        duration: DURATION,
      },
    },
    {
      name: "trial conversion start",
      schema: startConversionResponseSchema,
      response: {
        result: "created",
        conversion: {
          conversionId: UUID,
          sourceUrl: "https://example.com/source",
          acceptedAt: ACCEPTED_AT,
          completedAt: ACCEPTED_AT,
          status: "failed",
          failure: { category: "internal", explanation: "Failed.", newField: true },
          newField: true,
        },
        duration: { ...DURATION, newField: true },
        newField: true,
      },
      expected: {
        result: "created",
        conversion: {
          conversionId: UUID,
          sourceUrl: "https://example.com/source",
          acceptedAt: ACCEPTED_AT,
          completedAt: ACCEPTED_AT,
          status: "failed",
          failure: { category: "internal", explanation: "Failed." },
        },
        duration: DURATION,
      },
    },
    {
      name: "retry",
      schema: retryConversionResponseSchema,
      response: { result: "started", newField: true },
      expected: { result: "started" },
    },
    {
      name: "account snapshot",
      schema: accountSnapshotSchema,
      response: {
        ...ACCOUNT_SNAPSHOT,
        balance: { ...ACCOUNT_SNAPSHOT.balance, newField: true },
        newField: true,
      },
      expected: ACCOUNT_SNAPSHOT,
    },
    {
      name: "account history",
      schema: accountHistorySchema,
      response: {
        items: [
          {
            conversionId: UUID,
            idempotencyKey: UUID,
            sourceUrl: "https://example.com/source",
            createdAtMs: 1,
            status: "ready",
            outcome: { status: "ready", title: "Document", newField: true },
            newField: true,
          },
        ],
        nextCursor: null,
        newField: true,
      },
      expected: {
        items: [
          {
            conversionId: UUID,
            idempotencyKey: UUID,
            sourceUrl: "https://example.com/source",
            createdAtMs: 1,
            status: "ready",
            outcome: { status: "ready", title: "Document" },
          },
        ],
        nextCursor: null,
      },
    },
    {
      name: "error",
      schema: errorResponseSchema,
      response: {
        error: { code: "grant-expired", message: "Expired.", requestId: UUID, newField: true },
        newField: true,
      },
      expected: { error: { code: "grant-expired", message: "Expired.", requestId: UUID } },
    },
  ])("drops unknown fields in the $name response", ({ schema, response, expected }) => {
    expect(schema.parse(response)).toStrictEqual(expected);
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
    expect(audiobookSchema.safeParse(PREPARED_AUDIOBOOK).success).toBe(true);
    expect(
      audiobookSchema.safeParse({
        ...PREPARED_AUDIOBOOK,
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
  ])("rejects incomplete audio segment states", (segment) => {
    expect(audioSegmentSchema.safeParse(segment).success).toBe(false);
  });

  test.each([
    [
      { sequence: 0, status: "absent", explanation: "Unexpected failure" },
      { sequence: 0, status: "absent" },
    ],
    [
      { sequence: 0, status: "generating", explanation: "Unexpected failure" },
      { sequence: 0, status: "generating" },
    ],
    [
      {
        sequence: 0,
        status: "failed",
        explanation: "Speech failed",
        url: "https://example.com/audio.mp3",
      },
      { sequence: 0, status: "failed", explanation: "Speech failed" },
    ],
  ])("reads only the fields of the reported audio segment state", (segment, expected) => {
    expect(audioSegmentSchema.parse(segment)).toStrictEqual(expected);
  });

  test("drops conversions from the grant snapshot", () => {
    const grant = {
      grantId: UUID,
      createdAt: ACCEPTED_AT,
      expiresAt: ACCEPTED_AT,
      state: "open",
      duration: DURATION,
    };
    expect(grantSnapshotSchema.parse({ ...grant, conversions: [] })).toStrictEqual(grant);
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
