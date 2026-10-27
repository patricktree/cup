import { z } from "zod";

import {
  accountDurationBalanceSchema,
  accountHistoryItemSchema,
  accountOutcomeSchema,
  accountSnapshotSchema as sharedAccountSnapshotSchema,
} from "@cup/accounts/contracts";
import {
  playbackPositionSchema as sharedPlaybackPositionSchema,
  durationBalanceSchema,
  sourceUrlSchema,
  insufficientDurationSchema,
} from "@cup/conversion-contracts";
import {
  grantConversionSnapshotSchema,
  grantConversionsSchema,
  grantSnapshotSchema as sharedGrantSnapshotSchema,
  type GrantConversionSnapshot,
  type GrantConversions,
  type GrantState,
} from "@cup/conversion-grants/contracts";
import { SYNCHRONIZATION_UNIT_SCHEMA } from "@cup/narration-document-creation";

const LOWERCASE_UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CREDENTIAL_PATTERN = /^v1\.[A-Za-z0-9_-]{43}$/;

/*
 * Listener request and response schemas drop unknown fields instead of rejecting them: installed
 * apps keep sending fields a newer Worker no longer reads, and keep parsing responses from newer
 * Workers. Strict schemas shared with internal boundaries (storage, workflows, operator contracts)
 * are rebuilt here from their shapes; the trial conversion snapshot only describes listener
 * responses, so it is tolerant where it is defined. Route tests parse responses with strict
 * variants of these schemas.
 */

export { sourceUrlSchema, grantConversionSnapshotSchema, grantConversionsSchema };
export type { GrantConversionSnapshot, GrantConversions, GrantState };

const durationBalanceResponseSchema = z.object(durationBalanceSchema.shape);
const accountDurationBalanceResponseSchema = z.object(accountDurationBalanceSchema.shape);
const synchronizationUnitResponseSchema = z.object(SYNCHRONIZATION_UNIT_SCHEMA.shape);
/** The saved-position request body and the position in audiobook responses. */
export const playbackPositionSchema = z.object(sharedPlaybackPositionSchema.shape);

export const grantSnapshotSchema = z.object({
  ...sharedGrantSnapshotSchema.shape,
  duration: durationBalanceResponseSchema,
});
export type GrantSnapshot = z.infer<typeof grantSnapshotSchema>;

export const uuidV4Schema = z
  .string()
  .regex(LOWERCASE_UUID_V4_PATTERN, "Must be a lowercase UUIDv4");

export const authConfigResponseSchema = z.object({
  supabaseUrl: z.string(),
  publishableKey: z.string().min(1),
  /** Absent when Google sign-in is unavailable, which happens only in local development. */
  googleWebClientId: z.string().min(1).optional(),
  /** Advertised only in local development; see ADR 0012. */
  testAccount: z.object({ email: z.string().min(1), password: z.string().min(1) }).optional(),
});

export const grantParamsSchema = z.object({ grantId: uuidV4Schema });
export type GrantParams = z.infer<typeof grantParamsSchema>;
export const conversionParamsSchema = z.object({ conversionId: uuidV4Schema });
export type ConversionParams = z.infer<typeof conversionParamsSchema>;

export const exchangeCredentialRequestSchema = z.object({
  credential: z.string().regex(CREDENTIAL_PATTERN),
});
export type ExchangeCredentialRequest = z.infer<typeof exchangeCredentialRequestSchema>;

export const startConversionRequestSchema = z.object({
  sourceUrl: sourceUrlSchema,
});
export type StartConversionRequest = z.infer<typeof startConversionRequestSchema>;

export const startConversionHeadersSchema = z
  .object({
    "content-type": z.literal("application/json"),
    "x-create-audiobook-from-url-request": z.literal("1"),
    "idempotency-key": uuidV4Schema,
  })
  .passthrough();
export const browserMutationHeadersSchema = z
  .object({
    "content-type": z.literal("application/json"),
    "x-create-audiobook-from-url-request": z.literal("1"),
  })
  .passthrough();
export const startConversionResponseSchema = z.object({
  result: z.enum(["created", "replayed"]),
  conversion: grantConversionSnapshotSchema,
  duration: durationBalanceResponseSchema,
});
export type StartConversionResponse = z.infer<typeof startConversionResponseSchema>;

export type { PlaybackPosition } from "@cup/conversion-contracts";
const audioSegmentBaseSchema = z.object({ sequence: z.number().int().nonnegative() });
/** A segment's speech state. Ready segments play through the audiobook's `narrationTrack`. */
export const audioSegmentSchema = z.discriminatedUnion("status", [
  audioSegmentBaseSchema.extend({ status: z.literal("absent") }),
  audioSegmentBaseSchema.extend({ status: z.literal("generating") }),
  audioSegmentBaseSchema.extend({ status: z.literal("ready") }),
  audioSegmentBaseSchema.extend({ status: z.literal("failed"), explanation: z.string() }),
]);
export type AudioSegment = z.infer<typeof audioSegmentSchema>;
/**
 * The query of a media route under `/api/files`. `token` is the opaque, expiring authorization a
 * signed media URL carries, the only credential media routes accept.
 */
export const signedMediaUrlQuerySchema = z.object({ token: z.string() });
/**
 * Where to request the audiobook's narration track (a signed media URL), and where each segment
 * starts in it. `startMilliseconds[i]` is the sum of the settled durations of segments `0..i-1`.
 */
export const narrationTrackSchema = z.object({
  url: z.url(),
  durationMilliseconds: z.number().int().positive(),
  startMilliseconds: z.array(z.number().int().nonnegative()).min(1),
});
export type NarrationTrack = z.infer<typeof narrationTrackSchema>;
/** Where to request the audiobook's cover image: a signed media URL. */
export const coverImageSchema = z.object({
  url: z.url(),
  alternativeText: z.string().min(1).optional(),
});
export type CoverImage = z.infer<typeof coverImageSchema>;
/**
 * The step of preparing a pending conversion's narration document that the conversion last started,
 * as listeners see it. Several internal phases share one value.
 */
export const preparationPhaseSchema = z.enum([
  "starting",
  "reading-page",
  "selecting-content",
  "preparing-text",
]);
export type PreparationPhase = z.infer<typeof preparationPhaseSchema>;
/**
 * Absent when no listener phase applies. A value this client does not know parses as absent, so a
 * newer Worker can add phases without failing the response. Preprocessing keeps the enum in the
 * OpenAPI document, which describes the schema after it.
 */
const pendingPreparationPhaseSchema = z
  .preprocess(
    (value) =>
      typeof value === "string" && !preparationPhaseSchema.safeParse(value).success
        ? undefined
        : value,
    preparationPhaseSchema.optional(),
  )
  .optional();
const readerBase = { originalUrl: sourceUrlSchema, canGenerate: z.boolean() };
const preparedBase = {
  ...readerBase,
  title: z.string().min(1),
  // Absent when the audiobook has no cover image.
  coverImage: coverImageSchema.optional(),
  narrationDocument: z.object({
    html: z.string().min(1),
    synchronizationUnits: z.array(synchronizationUnitResponseSchema).min(1),
  }),
  // One entry per synchronization unit, in document order.
  segments: z.array(audioSegmentSchema),
  // Present only when every segment has settled audio.
  narrationTrack: narrationTrackSchema.optional(),
  playbackPosition: playbackPositionSchema.nullable(),
};
export const audiobookSchema = z.discriminatedUnion("status", [
  z.object({
    ...readerBase,
    status: z.literal("pending"),
    preparationPhase: pendingPreparationPhaseSchema,
  }),
  z.object({ ...readerBase, status: z.literal("failed"), explanation: z.string() }),
  // The whole narration document did not fit the available duration; nothing was reserved.
  z.object({
    ...preparedBase,
    status: z.literal("insufficient-duration"),
    ...insufficientDurationSchema.shape,
  }),
  z.object({ ...preparedBase, status: z.literal("synthesizing") }),
  // Every segment has audio or a final failure, so the total duration is known.
  z.object({ ...preparedBase, status: z.literal("ready") }),
]);
export type Audiobook = z.infer<typeof audiobookSchema>;

/** A refused retry reserves nothing; the durations tell the reader why. */
export const retryConversionResponseSchema = z.discriminatedUnion("result", [
  z.object({ result: z.literal("started") }),
  z.object({ result: z.literal("insufficient-duration"), ...insufficientDurationSchema.shape }),
]);
export type RetryConversionResponse = z.infer<typeof retryConversionResponseSchema>;

/**
 * Every `code` of a listener API error response, including the codes of the server-wide middleware
 * that also guards listener routes, such as `request-too-large`.
 */
export const ERROR_CODE = {
  ACCOUNT_BLOCKED: "account-blocked",
  ACCOUNT_SESSION_REQUIRED: "account-session-required",
  ACCOUNT_SETUP_PENDING: "account-setup-pending",
  ACCOUNT_START_CONFLICT: "account-start-conflict",
  AUDIOBOOK_NOT_FOUND: "audiobook-not-found",
  CONFIRMATION_UNAVAILABLE: "confirmation-unavailable",
  COVER_IMAGE_NOT_FOUND: "cover-image-not-found",
  CREDITS_UNAVAILABLE: "credits-unavailable",
  DEPENDENCY_UNAVAILABLE: "dependency-unavailable",
  FRESH_AUTH_REQUIRED: "fresh-auth-required",
  GRANT_EXHAUSTED: "grant-exhausted",
  GRANT_EXPIRED: "grant-expired",
  GRANT_REVOKED: "grant-revoked",
  GRANT_SESSION_INVALID: "grant-session-invalid",
  GRANT_SESSION_REQUIRED: "grant-session-required",
  GRANT_TEMPORARILY_FULL: "grant-temporarily-full",
  IDEMPOTENCY_CONFLICT: "idempotency-conflict",
  INGRESS_UNAVAILABLE: "ingress-unavailable",
  INVALID_CREDENTIAL: "invalid-credential",
  INVALID_INPUT: "invalid-input",
  MEDIA_URL_INVALID: "media-url-invalid",
  METHOD_NOT_ALLOWED: "method-not-allowed",
  NARRATION_TRACK_NOT_FOUND: "narration-track-not-found",
  NOT_FOUND: "not-found",
  OPERATIONAL_ERROR: "operational-error",
  ORIGIN_BLOCKED: "origin-blocked",
  ORIGIN_FORBIDDEN: "origin-forbidden",
  RANGE_NOT_SATISFIABLE: "range-not-satisfiable",
  RATE_LIMITED: "rate-limited",
  REQUEST_TOO_LARGE: "request-too-large",
  START_RATE_LIMITED: "start-rate-limited",
  UNSUPPORTED_MEDIA_TYPE: "unsupported-media-type",
} as const;
export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODE),
    message: z.string().min(1),
    requestId: uuidV4Schema,
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const accountConfirmationSchema = z.object({
  challengeId: z.uuidv4(),
  providerToken: z.string().min(1).max(8192).optional(),
});
export type AccountConfirmationRequest = z.infer<typeof accountConfirmationSchema>;

/*
 * Keeps the account contract's fields and value checks. The balance is replaced because the spread
 * shape still holds the account contract's strict balance schema.
 */
export const accountSnapshotSchema = z.object({
  ...sharedAccountSnapshotSchema.shape,
  balance: accountDurationBalanceResponseSchema,
});

export type AccountSnapshot = z.infer<typeof accountSnapshotSchema>;

// Follows the option order in `accountOutcomeSchema`; a reordering there fails to compile here.
const [readyAccountOutcomeSchema, failedAccountOutcomeSchema] = accountOutcomeSchema.options;
/** An account conversion without its completion time, storage reference, or failure category. */
export const historyItemSchema = z.object({
  ...accountHistoryItemSchema.pick({
    conversionId: true,
    idempotencyKey: true,
    sourceUrl: true,
    createdAtMs: true,
    status: true,
  }).shape,
  // Reported only while the conversion is pending.
  preparationPhase: pendingPreparationPhaseSchema,
  outcome: z
    .discriminatedUnion("status", [
      z.object(
        readyAccountOutcomeSchema.pick({ status: true, title: true, hasCoverImage: true }).shape,
      ),
      z.object(failedAccountOutcomeSchema.pick({ status: true, explanation: true }).shape),
    ])
    .nullable(),
});
export type HistoryItem = z.infer<typeof historyItemSchema>;

export const accountStartResponseSchema = z.object({ conversionId: z.uuidv4() });

export const deletionChallengeSchema = z.object({
  challengeId: z.uuidv4(),
  subject: z.uuid(),
  issuedAtMs: z.number(),
  expiresAtMs: z.number(),
});
export type DeletionChallenge = z.infer<typeof deletionChallengeSchema>;
export const scheduleDeletionResponseSchema = z.object({
  state: z.literal("deletion_scheduled"),
  recoveryDeadlineMs: z.number().optional(),
});
export type ScheduleDeletionResponse = z.infer<typeof scheduleDeletionResponseSchema>;
export const accountHistorySchema = z.object({
  items: z.array(historyItemSchema),
  nextCursor: z.string().nullable(),
});
export type AccountHistory = z.infer<typeof accountHistorySchema>;
