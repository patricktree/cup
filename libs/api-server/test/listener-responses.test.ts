import { beforeEach, expect, test, vi } from "vitest";
import type { z } from "zod";

import { SPEECH_CONFIG } from "@cup/audiobook-production";
import { createConversionArtifactPrefix } from "@cup/conversion-contracts";
import {
  accountHistorySchema,
  accountSnapshotSchema,
  accountStartResponseSchema,
  audiobookSchema,
  authConfigResponseSchema,
  deletionChallengeSchema,
  grantSnapshotSchema,
  retryConversionResponseSchema,
  scheduleDeletionResponseSchema,
  startConversionResponseSchema,
} from "@cup/listener-api.routes";

import type { ApiServerEnvironment } from "#src/api-server-environment.ts";
import { createApiServer } from "#src/api-server.ts";
import { toPreparationPhase } from "#src/http/listener-responses.ts";

import { toStrictSchema } from "#test/strict-schema.ts";

// Fake Durable Object results that handlers pass on carry `internalRevision`, a field no listener
// contract declares, as a stand-in for internal fields that the owning packages may add later.

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    readonly mocked = true;
  },
}));
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock("#src/http/ingress-identity.ts", () => ({ ingressIdentity: async () => "ingress-key" }));
vi.mock("#src/http/account-auth.ts", async (original) => ({
  ...(await original<typeof import("#src/http/account-auth.ts")>()),
  authenticateAccountRequest: mocks.authenticate,
}));

const accountId = "d1a52e64-3e4d-4a7f-a711-7fb11501e9af";
const subject = "f355f913-ba12-45d6-a7d2-4df95f7cf11f";
const grantId = "0b3c9a4e-6f1d-4c2a-9e7b-5d8f1a2c3b4e";
const accountConversionId = "f9cc2e59-46a3-4890-b923-bda04d03b4d0";
const failedConversionId = "6a1f3c2e-8b4d-4e5f-9a7c-1d2e3f4a5b6c";
const pendingConversionId = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const trialConversionId = "3e7a9c1b-2d4f-4a6b-8c9d-0e1f2a3b4c5d";
const readyTrialConversionId = "4f8b0d2c-3e5a-4b7c-9d0e-1f2a3b4c5d6e";
const failedTrialConversionId = "5a9c1e3d-4f6b-4c8d-ae1f-2a3b4c5d6e7f";
const challengeId = "7c2e4a6b-8d1f-4e3a-9b5c-6d7e8f9a0b1c";
const idempotencyKey = "9d8c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const origin = "https://cup.audio";
const grantCookie = `__Secure-grant-session-${grantId}=valid-session`;
const credential = `v1.${"a".repeat(43)}`;

const accountSnapshot = {
  accountId,
  subject,
  createdAtMs: 1_000,
  state: "active",
  executionEpoch: 1,
  recoveryDeadlineMs: null,
  balance: { unit: "audio-millisecond", available: 1_800_000, reserved: 0 },
};
const duration = {
  availableMilliseconds: 1_000_000,
  reservedMilliseconds: 0,
  spentMilliseconds: 200_000,
};
const grantSnapshot = {
  grantId,
  createdAt: "2026-10-01T00:00:00.000Z",
  expiresAt: "2026-11-01T00:00:00.000Z",
  state: "open",
  duration: { ...duration, internalRevision: 7 },
  internalRevision: 7,
};
const manifest = JSON.stringify({
  title: "A document",
  originalUrl: "https://example.com/source",
  speechConfig: SPEECH_CONFIG,
  narrationDocument: {
    html: '<h1 id="synchronization-unit-1">A document</h1>',
    synchronizationUnits: [{ id: "synchronization-unit-1", narrationText: "A document" }],
  },
  coverImage: { contentType: "image/jpeg", byteLength: 3, alternativeText: "A lighthouse" },
});
const audiobookReference = {
  key: `${createConversionArtifactPrefix(accountConversionId, { kind: "account", accountId })}audiobook.json`,
  contentType: "application/json",
  byteLength: manifest.length,
  etag: "manifest-etag",
};
const readyAccountConversion = {
  conversionId: accountConversionId,
  idempotencyKey,
  sourceUrl: "https://example.com/source",
  createdAtMs: 2_000,
  status: "ready",
  lastStartedPhase: "finalization",
  completedAtMs: 3_000,
  outcome: { status: "ready", title: "A document", audiobookReference, hasCoverImage: true },
};
const failedAccountConversion = {
  conversionId: failedConversionId,
  idempotencyKey,
  sourceUrl: "https://example.com/broken",
  createdAtMs: 1_500,
  status: "failed",
  lastStartedPhase: "source-material-preparation",
  completedAtMs: 1_600,
  outcome: {
    status: "failed",
    failureCategory: "source-unavailable",
    explanation: "The page could not be loaded.",
  },
};
const uncoveredAccountConversion = {
  ...readyAccountConversion,
  conversionId: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
  outcome: { status: "ready", title: "No cover", audiobookReference },
};
const pendingAccountConversion = {
  conversionId: pendingConversionId,
  idempotencyKey,
  sourceUrl: "https://example.com/pending",
  createdAtMs: 1_000,
  status: "pending",
  lastStartedPhase: "narration-content-selection",
  completedAtMs: null,
  outcome: null,
};
const accountConversions = new Map<string, object>([
  [accountConversionId, readyAccountConversion],
  [failedConversionId, failedAccountConversion],
  [pendingConversionId, pendingAccountConversion],
]);
const settledSegments = [
  { sequence: 0, state: "settled", actualMilliseconds: 1_000, internalRevision: 7 },
];

const account = {
  inspect: async () => accountSnapshot,
  deletionChallenge: async () => ({
    challengeId,
    subject,
    issuedAtMs: 1_000,
    expiresAtMs: 301_000,
    internalRevision: 7,
  }),
  scheduleDeletion: async () => ({
    result: "scheduled",
    attempt: { attemptId: challengeId, deadlineMs: 2_000, internalRevision: 7 },
  }),
  restoreAccount: async () => ({
    result: "restored",
    account: { ...accountSnapshot, internalRevision: 7 },
  }),
  history: async () => ({
    items: [
      readyAccountConversion,
      uncoveredAccountConversion,
      failedAccountConversion,
      pendingAccountConversion,
    ],
    nextCursor: null,
  }),
  startConversion: async () => ({
    result: "created",
    conversion: { ...readyAccountConversion, status: "pending", outcome: null },
  }),
  getConversion: async (conversionId: string) => accountConversions.get(conversionId),
  listAudioSegments: async () => settledSegments,
  getPlaybackPosition: async () => ({
    synchronizationUnitId: "synchronization-unit-1",
    offsetMilliseconds: 500,
    internalRevision: 7,
  }),
  retryPreparation: async () => undefined,
  startSynthesis: async () => ({
    result: "insufficient-duration",
    requiredMilliseconds: 5_000,
    availableMilliseconds: 1_000,
    internalRevision: 7,
  }),
};
const trialConversion = {
  conversionId: trialConversionId,
  idempotencyKey,
  sourceUrl: "https://example.com/trial",
  createdAtMs: 4_000,
  status: "pending",
  lastStartedPhase: "conversion-start",
  workflowStartedAtMs: 4_001,
};
const trialConversions = [
  trialConversion,
  {
    ...trialConversion,
    conversionId: readyTrialConversionId,
    sourceUrl: "https://example.com/trial-ready",
    status: "ready",
    completedAtMs: 5_000,
    title: "A trial document",
    audiobookReference,
    measurements: { narrationTextCharacters: 10, narrationChunks: 1 },
  },
  {
    ...trialConversion,
    conversionId: failedTrialConversionId,
    sourceUrl: "https://example.com/trial-failed",
    status: "failed",
    completedAtMs: 5_000,
    failureCategory: "source-preparation",
    explanation: "The page could not be loaded.",
    diagnosticReference: "diagnostics/trial-failed",
  },
];
const grant = {
  validateSession: async (token: string) =>
    token === "valid-session"
      ? { result: "valid", snapshot: grantSnapshot }
      : { result: "invalid" },
  exchangeCredential: async () => ({
    result: "created",
    sessionToken: "valid-session",
    snapshot: grantSnapshot,
  }),
  getConversion: async (conversionId: string) =>
    trialConversions.find((conversion) => conversion.conversionId === conversionId),
  listAudioSegments: async () => [],
  startConversion: async (sourceUrl: string) => ({
    result: "replayed",
    conversion: trialConversions.find((conversion) => conversion.sourceUrl === sourceUrl),
    duration: { ...duration, internalRevision: 7 },
    registrySnapshot: { allowanceMilliseconds: 1_200_000 },
  }),
};

const env = {
  SUPABASE_URL: "https://access-test.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  GOOGLE_WEB_CLIENT_ID: "google-client",
  MEDIA_URL_SIGNING_KEY: "test-media-url-signing-key",
  ACCOUNTS: { idFromName: (name: string) => name, get: () => account },
  CONVERSION_GRANTS: { idFromName: (name: string) => name, get: () => grant },
  REGISTRY: {
    idFromName: (name: string) => name,
    get: () => ({
      consumeIngressRequest: async () => undefined,
      findConversionOwner: async (conversionId: string) =>
        trialConversions.some((conversion) => conversion.conversionId === conversionId)
          ? { kind: "trial", grantId }
          : { kind: "account", accountId },
    }),
  },
  AUDIO_BUCKET: {
    get: async (key: string) =>
      key === audiobookReference.key
        ? {
            size: audiobookReference.byteLength,
            etag: audiobookReference.etag,
            httpMetadata: { contentType: audiobookReference.contentType },
            text: async () => manifest,
          }
        : null,
  },
};
function isEnvironment(value: unknown): value is ApiServerEnvironment {
  return typeof value === "object" && value !== null && "REGISTRY" in value;
}

beforeEach(() => {
  mocks.authenticate.mockResolvedValue({
    result: "authenticated",
    identity: {
      subject,
      email: "listener@example.com",
      provider: "google",
      authenticatedAtSeconds: 10,
    },
    snapshot: { ...accountSnapshot, internalRevision: 7 },
    account,
  });
});

const browserMutation = {
  "Content-Type": "application/json",
  "X-Create-Audiobook-From-URL-Request": "1",
};

async function request(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
) {
  if (!isEnvironment(env)) {
    throw new Error("Invalid fixture");
  }
  return createApiServer().request(
    origin + path,
    {
      method: init.method ?? "GET",
      headers: { Authorization: "Bearer token", ...init.headers },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    },
    env,
  );
}

async function parseStrictly<Schema extends z.ZodType>(
  response: Response,
  status: number,
  schema: Schema,
): Promise<z.infer<Schema>> {
  expect(response.status).toBe(status);
  return toStrictSchema(schema).parse(await response.json());
}

test("the auth configuration declares only the public sign-in settings", async () => {
  expect(
    await parseStrictly(await request("/api/auth/config"), 200, authConfigResponseSchema),
  ).toEqual({
    supabaseUrl: "https://access-test.supabase.co",
    publishableKey: "publishable-key",
    googleWebClientId: "google-client",
  });
});

test("the auth configuration advertises the test account only in local development", async () => {
  const testAccountEnv = {
    ...env,
    LOCAL_TEST_ACCOUNT_EMAIL: "test@cup.local",
    LOCAL_TEST_ACCOUNT_PASSWORD: "local-password",
  };
  const config = async (overrides: Record<string, string>) =>
    parseStrictly(
      await createApiServer().request(
        `${origin}/api/auth/config`,
        {},
        {
          ...testAccountEnv,
          ...overrides,
        },
      ),
      200,
      authConfigResponseSchema,
    );
  expect(await config({ LOCAL_DEVELOPMENT: "false" })).not.toHaveProperty("testAccount");
  expect(await config({ LOCAL_DEVELOPMENT: "true", GOOGLE_WEB_CLIENT_ID: "" })).toEqual({
    supabaseUrl: "https://access-test.supabase.co",
    publishableKey: "publishable-key",
    testAccount: { email: "test@cup.local", password: "local-password" },
  });
});

test("the account snapshot carries only declared fields", async () => {
  expect(await parseStrictly(await request("/api/account"), 200, accountSnapshotSchema)).toEqual(
    accountSnapshot,
  );
});

test("deletion challenge, scheduling, and restore responses carry only declared fields", async () => {
  await parseStrictly(
    await request("/api/account/deletion/challenge", {
      method: "POST",
      headers: browserMutation,
      body: {},
    }),
    200,
    deletionChallengeSchema,
  );
  expect(
    await parseStrictly(
      await request("/api/account/deletion", {
        method: "POST",
        headers: browserMutation,
        body: { challengeId },
      }),
      200,
      scheduleDeletionResponseSchema,
    ),
  ).toEqual({ state: "deletion_scheduled", recoveryDeadlineMs: 2_000 });
  expect(
    await parseStrictly(
      await request("/api/account/deletion/restore", {
        method: "POST",
        headers: browserMutation,
        body: { challengeId },
      }),
      200,
      accountSnapshotSchema,
    ),
  ).toEqual(accountSnapshot);
});

test("history leaves out internal outcome fields and signs cover URLs only for covered ready conversions", async () => {
  const history = await parseStrictly(
    await request("/api/account/conversions"),
    200,
    accountHistorySchema,
  );
  expect(history.items.map((item) => item.outcome)).toEqual([
    {
      status: "ready",
      title: "A document",
      hasCoverImage: true,
      coverImage: {
        url: expect.stringMatching(
          new RegExp(
            `^${origin}/api/files/audiobooks/${accountConversionId}/cover-image\\?token=v1\\.`,
          ),
        ),
      },
    },
    { status: "ready", title: "No cover" },
    { status: "failed", explanation: "The page could not be loaded." },
    null,
  ]);
});

test("only a pending history item reports its preparation phase", async () => {
  const history = await parseStrictly(
    await request("/api/account/conversions"),
    200,
    accountHistorySchema,
  );
  expect(history.items.map((item) => item.preparationPhase)).toEqual([
    undefined,
    undefined,
    undefined,
    "selecting-content",
  ]);
});

test("a pending audiobook reports the preparation phase its owner last started", async () => {
  for (const [conversionId, preparationPhase] of [
    [pendingConversionId, "selecting-content"],
    [trialConversionId, "starting"],
  ] as const) {
    expect(
      await parseStrictly(
        await request(`/api/audiobooks/${conversionId}`, { headers: { Cookie: grantCookie } }),
        200,
        audiobookSchema,
      ),
    ).toMatchObject({ status: "pending", preparationPhase });
  }
});

test("a failed audiobook asks the listener to retry the track", async () => {
  expect(
    await parseStrictly(
      await request(`/api/audiobooks/${failedConversionId}`),
      200,
      audiobookSchema,
    ),
  ).toMatchObject({
    status: "failed",
    explanation: "Preparation failed. Retry to load this track.",
  });
});

test.each([
  ["conversion-start", "starting"],
  ["source-material-preparation", "reading-page"],
  ["narration-content-selection", "selecting-content"],
  ["narration-document-creation", "preparing-text"],
  ["audiobook-storage", "preparing-text"],
  ["finalization", "preparing-text"],
  ["audio-segment-production", undefined],
  ["audiobook-assembly", undefined],
] as const)("the %s phase reports the preparation phase %s", (phase, preparationPhase) => {
  expect(toPreparationPhase(phase)).toBe(preparationPhase);
});

test("an account start reports only the conversion ID", async () => {
  const started = await parseStrictly(
    await request("/api/account/conversions", {
      method: "POST",
      headers: { ...browserMutation, "Idempotency-Key": idempotencyKey },
      body: { sourceUrl: "https://example.com/source" },
    }),
    202,
    accountStartResponseSchema,
  );
  expect(started).toEqual({ conversionId: accountConversionId });
});

test("grant session exchange and grant reads carry only the declared snapshot", async () => {
  const { internalRevision: _, ...declaredSnapshot } = grantSnapshot;
  for (const [response, status] of [
    [
      await request(`/api/grants/${grantId}/sessions`, {
        method: "POST",
        headers: browserMutation,
        body: { credential },
      }),
      201,
    ],
    [await request(`/api/grants/${grantId}`, { headers: { Cookie: grantCookie } }), 200],
  ] as const) {
    expect(await parseStrictly(response, status, grantSnapshotSchema)).toEqual({
      ...declaredSnapshot,
      duration,
    });
  }
});

test("a trial start carries only the declared conversion and duration", async () => {
  const started = await parseStrictly(
    await request(`/api/grants/${grantId}/conversions`, {
      method: "POST",
      headers: { ...browserMutation, Cookie: grantCookie, "Idempotency-Key": idempotencyKey },
      body: { sourceUrl: "https://example.com/trial" },
    }),
    200,
    startConversionResponseSchema,
  );
  expect(started).toEqual({
    result: "replayed",
    conversion: {
      conversionId: trialConversionId,
      sourceUrl: "https://example.com/trial",
      acceptedAt: "1970-01-01T00:00:04Z",
      status: "pending",
    },
    duration,
  });
});

test("the audiobook carries only declared fields", async () => {
  const audiobook = await parseStrictly(
    await request(`/api/audiobooks/${accountConversionId}`),
    200,
    audiobookSchema,
  );
  expect(audiobook).toMatchObject({
    status: "ready",
    playbackPosition: { synchronizationUnitId: "synchronization-unit-1", offsetMilliseconds: 500 },
    narrationTrack: { durationMilliseconds: 1_000, startMilliseconds: [0] },
  });
});

test("a refused retry carries only the declared durations", async () => {
  expect(
    await parseStrictly(
      await request(`/api/audiobooks/${accountConversionId}/retry`, {
        method: "POST",
        headers: browserMutation,
        body: {},
      }),
      200,
      retryConversionResponseSchema,
    ),
  ).toEqual({
    result: "insufficient-duration",
    requiredMilliseconds: 5_000,
    availableMilliseconds: 1_000,
  });
});

test("a trial start carries only the declared fields of ready and failed conversions", async () => {
  for (const [sourceUrl, status] of [
    ["https://example.com/trial-ready", "ready"],
    ["https://example.com/trial-failed", "failed"],
  ] as const) {
    const started = await parseStrictly(
      await request(`/api/grants/${grantId}/conversions`, {
        method: "POST",
        headers: { ...browserMutation, Cookie: grantCookie, "Idempotency-Key": idempotencyKey },
        body: { sourceUrl },
      }),
      200,
      startConversionResponseSchema,
    );
    expect(started.conversion).toMatchObject({ sourceUrl, status });
  }
});

test("pending and failed audiobooks carry only declared fields", async () => {
  for (const [conversionId, status] of [
    [pendingConversionId, "pending"],
    [failedConversionId, "failed"],
  ] as const) {
    const audiobook = await parseStrictly(
      await request(`/api/audiobooks/${conversionId}`),
      200,
      audiobookSchema,
    );
    expect(audiobook.status).toBe(status);
  }
});

test("a retried preparation reports only that it started", async () => {
  expect(
    await parseStrictly(
      await request(`/api/audiobooks/${failedConversionId}/retry`, {
        method: "POST",
        headers: browserMutation,
        body: {},
      }),
      200,
      retryConversionResponseSchema,
    ),
  ).toEqual({ result: "started" });
});
