import { z } from "zod";

import {
  playbackPositionSchema,
  conversionPhaseSchema,
  durationBalanceSchema,
} from "@cup/conversion-contracts";
import { sourceUrlSchema } from "@cup/conversion-contracts";
import {
  grantConversionSnapshotSchema,
  grantConversionsSchema,
  grantSnapshotSchema,
  type GrantConversionSnapshot,
  type GrantConversions,
  type GrantSnapshot,
  type GrantState,
} from "@cup/conversion-grants/contracts";
import { SYNCHRONIZATION_UNIT_SCHEMA } from "@cup/narration-document-creation";

const LOWERCASE_UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CREDENTIAL_PATTERN = /^v1\.[A-Za-z0-9_-]{43}$/;

export {
  sourceUrlSchema,
  grantConversionSnapshotSchema,
  grantConversionsSchema,
  grantSnapshotSchema,
};
export type { GrantConversionSnapshot, GrantConversions, GrantSnapshot, GrantState };

export const uuidV4Schema = z
  .string()
  .regex(LOWERCASE_UUID_V4_PATTERN, "Must be a lowercase UUIDv4");

export const authConfigResponseSchema = z.object({
  supabaseUrl: z.string(),
  publishableKey: z.string().min(1),
  googleWebClientId: z.string(),
});

export const grantParamsSchema = z.object({ grantId: uuidV4Schema }).strict();
export type GrantParams = z.infer<typeof grantParamsSchema>;
export const conversionParamsSchema = z.object({ conversionId: uuidV4Schema }).strict();
export type ConversionParams = z.infer<typeof conversionParamsSchema>;

export const conversionDetailSchema = z.discriminatedUnion("status", [
  grantConversionSnapshotSchema.options[0].extend({
    lastStartedPhase: conversionPhaseSchema,
  }),
  grantConversionSnapshotSchema.options[1],
  grantConversionSnapshotSchema.options[2],
]);
export type ConversionDetail = z.infer<typeof conversionDetailSchema>;

export const exchangeCredentialRequestSchema = z
  .object({ credential: z.string().regex(CREDENTIAL_PATTERN) })
  .strict();
export type ExchangeCredentialRequest = z.infer<typeof exchangeCredentialRequestSchema>;

export const startConversionRequestSchema = z
  .object({
    sourceUrl: sourceUrlSchema,
  })
  .strict();
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
export const startConversionResponseSchema = z
  .object({
    result: z.enum(["created", "replayed"]),
    conversion: grantConversionSnapshotSchema,
    duration: durationBalanceSchema,
  })
  .strict();
export type StartConversionResponse = z.infer<typeof startConversionResponseSchema>;

export { playbackPositionSchema };
export type { PlaybackPosition } from "@cup/conversion-contracts";
export const segmentParamsSchema = conversionParamsSchema.extend({
  sequence: z.coerce.number().int().min(0).max(199),
});
const audioSegmentBaseSchema = z.object({ sequence: z.number().int().nonnegative() }).strict();
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
const readerBase = { originalUrl: sourceUrlSchema, canGenerate: z.boolean() };
export const audiobookSchema = z.discriminatedUnion("status", [
  z.object({ ...readerBase, status: z.literal("pending") }).strict(),
  z.object({ ...readerBase, status: z.literal("failed"), explanation: z.string() }).strict(),
  z
    .object({
      ...readerBase,
      status: z.literal("ready"),
      title: z.string().min(1),
      narrationDocument: z
        .object({
          html: z.string().min(1),
          synchronizationUnits: z.array(SYNCHRONIZATION_UNIT_SCHEMA).min(1),
        })
        .strict(),
      segments: z.array(audioSegmentSchema),
      playbackPosition: playbackPositionSchema.nullable(),
    })
    .strict(),
]);
export type Audiobook = z.infer<typeof audiobookSchema>;

export const errorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        message: z.string().min(1),
        requestId: uuidV4Schema,
      })
      .strict(),
  })
  .strict();
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const accountConfirmationSchema = z
  .object({
    challengeId: z.uuidv4(),
    providerToken: z.string().min(1).max(8192).optional(),
  })
  .strict();
export type AccountConfirmationRequest = z.infer<typeof accountConfirmationSchema>;

export const accountSnapshotSchema = z.object({
  accountId: z.uuid(),
  subject: z.uuid(),
  createdAtMs: z.number(),
  state: z.enum(["active", "deletion_scheduled", "deleting"]),
  executionEpoch: z.number(),
  recoveryDeadlineMs: z.number().nullable(),
  balance: z.object({
    unit: z.literal("audio-millisecond"),
    available: z.number(),
    reserved: z.number(),
  }),
});

export const historyItemSchema = z.object({
  conversionId: z.uuidv4(),
  idempotencyKey: z.uuidv4(),
  sourceUrl: z.string(),
  createdAtMs: z.number(),
  status: z.enum(["pending", "ready", "failed"]),
  outcome: z.union([
    z.object({ status: z.literal("ready"), title: z.string() }).passthrough(),
    z.object({ status: z.literal("failed"), explanation: z.string() }).passthrough(),
    z.null(),
  ]),
});

export const accountStartResponseSchema = z.object({ conversionId: z.uuidv4() });

export const deletionChallengeSchema = z.object({
  challengeId: z.uuidv4(),
  subject: z.uuid(),
  issuedAtMs: z.number(),
  expiresAtMs: z.number(),
});
export const accountHistorySchema = z.object({
  items: z.array(historyItemSchema),
  nextCursor: z.string().nullable(),
});
