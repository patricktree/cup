import { z } from "zod";

export const accountIdentitySchema = z
  .object({
    accountId: z.uuidv4(),
    subject: z.uuid(),
    createdAtMs: z.number().int().nonnegative().safe(),
  })
  .strict();

export type AccountIdentity = z.infer<typeof accountIdentitySchema>;

/** The account's duration balance, in milliseconds of generated audio. */
export const accountDurationBalanceSchema = z
  .object({
    unit: z.literal("audio-millisecond"),
    available: z.number().int().nonnegative().safe(),
    reserved: z.number().int().nonnegative().safe(),
  })
  .strict();
export type AccountDurationBalance = z.infer<typeof accountDurationBalanceSchema>;

export const accountSnapshotSchema = accountIdentitySchema
  .extend({
    state: z.enum(["active", "deletion_scheduled", "deleting"]),
    executionEpoch: z.number().int().positive(),
    recoveryDeadlineMs: z.number().nullable(),
    balance: accountDurationBalanceSchema,
  })
  .strict();
export type AccountSnapshot = z.infer<typeof accountSnapshotSchema>;

/** The balance next to the totals reconstructed from the credit ledger, for operator inspection. */
export const accountAccountingInspectionSchema = z
  .object({
    balance: accountDurationBalanceSchema,
    reconstructed: z.object({ available: z.number(), reserved: z.number() }).strict(),
    entries: z.number().int().nonnegative(),
  })
  .strict();
export type AccountAccountingInspection = z.infer<typeof accountAccountingInspectionSchema>;

/** An artifact writer that is not yet drained, for operator inspection. */
export const accountArtifactWriterSchema = z
  .object({
    writerId: z.string(),
    prefix: z.string(),
    state: z.enum(["running", "drained", "uncertain"]),
    effect: z.string().nullable(),
  })
  .strict();
export type AccountArtifactWriter = z.infer<typeof accountArtifactWriterSchema>;
/** Increases when a projected field changes meaning, so the registry can tell older projections. */
export const ACCOUNT_USAGE_PROJECTION_SCHEMA_VERSION = 1;

/**
 * The account's duration usage as the registry keeps it for operator listings. The account is
 * authoritative; `revision` orders projections so that the registry never replaces newer usage.
 */
export const accountUsageProjectionSchema = z
  .object({
    accountId: z.uuidv4(),
    revision: z.number().int().positive().safe(),
    allowanceMilliseconds: z.number().int().nonnegative().safe(),
    reservedMilliseconds: z.number().int().nonnegative().safe(),
    spentMilliseconds: z.number().int().nonnegative().safe(),
    schemaVersion: z.number().int().positive().safe(),
  })
  .strict();

export type AccountUsageProjection = z.infer<typeof accountUsageProjectionSchema>;

export type AccountConversion = {
  conversionId: string;
  idempotencyKey: string;
  sourceUrl: string;
  createdAtMs: number;
  status: "pending" | "ready" | "failed";
};

export const startAccountConversionSchema = z
  .object({
    idempotencyKey: z.uuidv4(),
    sourceUrl: z
      .string()
      .max(2048)
      .url()
      .refine((value) => {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
      }, "Source URL must use HTTP or HTTPS without credentials"),
  })
  .strict();

export const accountOutcomeSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("ready"),
      title: z.string().min(1),
      audiobookReference: z
        .object({
          key: z.string().min(1),
          contentType: z.literal("application/json"),
          byteLength: z.number().int().positive().safe(),
          etag: z.string().min(1),
        })
        .strict(),
      /** Recorded only when the audiobook has one, so outcomes without it keep their fingerprint. */
      hasCoverImage: z.literal(true).optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal("failed"),
      failureCategory: z.string().min(1),
      explanation: z.string().min(1),
    })
    .strict(),
]);
export type AccountConversionOutcome = z.infer<typeof accountOutcomeSchema>;

/**
 * A conversion as account history reports it. A prepared conversion reports the state of its audio
 * instead of its stored `ready` status, as derived by `derivePreparedConversionStatus`.
 */
export const accountHistoryItemSchema = z
  .object({
    conversionId: z.uuid(),
    idempotencyKey: z.uuid(),
    sourceUrl: z.string(),
    createdAtMs: z.number(),
    status: z.enum(["pending", "insufficient-duration", "synthesizing", "ready", "failed"]),
    outcome: accountOutcomeSchema.nullable(),
    completedAtMs: z.number().nullable(),
  })
  .strict();
export type AccountHistoryItem = z.infer<typeof accountHistoryItemSchema>;

export const accountHistoryPageSchema = z
  .object({ items: z.array(accountHistoryItemSchema), nextCursor: z.string().nullable() })
  .strict();
export type AccountHistoryPage = z.infer<typeof accountHistoryPageSchema>;

export type AccountWorkflowParams = {
  v: 2;
  sourceUrl: string;
  owner: { kind: "account"; accountId: string };
  conversionId: string;
  executionEpoch: number;
};
