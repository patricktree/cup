import { z } from "zod";

import {
  conversionPhaseSchema,
  grantConversionSnapshotSchema,
  grantConversionsSchema,
  grantSnapshotSchema,
  durationBalanceSchema,
  type GrantConversionSnapshot,
  type GrantConversions,
  type GrantSnapshot,
  type GrantState,
} from "@cup/conversion-grants/contracts";
import { sourceUrlSchema } from "@cup/create-audiobook-from-url-workflow/conversion-params";
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

export const startConversionRequestSchema = z.object({ sourceUrl: sourceUrlSchema }).strict();
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

export const audiobookSchema = z
  .object({
    title: z.string().min(1),
    originalUrl: sourceUrlSchema,
    narrationDocument: z
      .object({
        html: z.string().min(1),
        synchronizationUnits: z.array(SYNCHRONIZATION_UNIT_SCHEMA).min(1),
      })
      .strict(),
    synchronizationCues: z
      .array(
        z
          .object({
            synchronizationUnitId: z.string().min(1),
            startMilliseconds: z.number().finite().nonnegative(),
            endMilliseconds: z.number().finite().positive(),
          })
          .strict(),
      )
      .min(1),
    audio: z.object({ contentType: z.literal("audio/mpeg"), url: z.url() }).strict(),
    captions: z.object({ contentType: z.literal("text/vtt"), url: z.url() }).strict(),
    epub: z.object({ contentType: z.literal("application/epub+zip"), url: z.url() }).strict(),
  })
  .strict();
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
