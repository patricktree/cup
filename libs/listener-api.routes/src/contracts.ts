import { z } from "zod";

import {
  accountDurationBalanceSchema,
  accountHistoryItemSchema,
  accountOutcomeSchema,
  accountSnapshotSchema as sharedAccountSnapshotSchema,
} from "@cup/accounts/contracts";
import {
  playbackPositionSchema as sharedPlaybackPositionSchema,
  conversionPhaseSchema,
  durationBalanceSchema,
} from "@cup/conversion-contracts";
import { sourceUrlSchema } from "@cup/conversion-contracts";
import { insufficientDurationSchema } from "@cup/conversion-contracts/duration-accounting";
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
  googleWebClientId: z.string(),
});

export const grantParamsSchema = z.object({ grantId: uuidV4Schema });
export type GrantParams = z.infer<typeof grantParamsSchema>;
export const conversionParamsSchema = z.object({ conversionId: uuidV4Schema });
export type ConversionParams = z.infer<typeof conversionParamsSchema>;

export const conversionDetailSchema = z.discriminatedUnion("status", [
  grantConversionSnapshotSchema.options[0].extend({
    lastStartedPhase: conversionPhaseSchema,
  }),
  // A prepared conversion reports the state of its audio; only `ready` can be played.
  grantConversionSnapshotSchema.options[1].extend({ status: z.literal("insufficient-duration") }),
  grantConversionSnapshotSchema.options[1].extend({ status: z.literal("synthesizing") }),
  grantConversionSnapshotSchema.options[1],
  grantConversionSnapshotSchema.options[2],
]);
export type ConversionDetail = z.infer<typeof conversionDetailSchema>;

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
export const segmentParamsSchema = conversionParamsSchema.extend({
  sequence: z.coerce.number().int().min(0).max(199),
});
const audioSegmentBaseSchema = z.object({ sequence: z.number().int().nonnegative() });
export const audioSegmentSchema = z.discriminatedUnion("status", [
  audioSegmentBaseSchema.extend({ status: z.literal("absent") }),
  audioSegmentBaseSchema.extend({ status: z.literal("generating") }),
  audioSegmentBaseSchema.extend({
    status: z.literal("ready"),
    durationMilliseconds: z.number().positive(),
    url: z.url(),
  }),
  audioSegmentBaseSchema.extend({ status: z.literal("failed"), explanation: z.string() }),
]);
export type AudioSegment = z.infer<typeof audioSegmentSchema>;
/** Where to request the audiobook's cover image; the bytes are served with audio-file authorization. */
export const coverImageSchema = z.object({
  url: z.url(),
  alternativeText: z.string().min(1).optional(),
});
export type CoverImage = z.infer<typeof coverImageSchema>;
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
  playbackPosition: playbackPositionSchema.nullable(),
};
export const audiobookSchema = z.discriminatedUnion("status", [
  z.object({ ...readerBase, status: z.literal("pending") }),
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

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
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

/** The account snapshot with the account contract's fields, rebuilt without its strictness. */
export const accountSnapshotSchema = z.object({
  ...sharedAccountSnapshotSchema.shape,
  balance: z.object(accountDurationBalanceSchema.shape),
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
