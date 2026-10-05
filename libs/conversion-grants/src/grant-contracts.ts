import { z } from "zod";

import { conversionFailureCategorySchema, durationBalanceSchema } from "@cup/conversion-contracts";

const AUDIOBOOK_PATH_PATTERN =
  /^\/app\/audiobooks\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LOWERCASE_UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const uuidV4Schema = z.string().regex(LOWERCASE_UUID_V4_PATTERN, "Must be a lowercase UUIDv4");
const sourceUrlSchema = z.url();

export const grantStates = ["open", "temporarily-full", "exhausted", "expired", "revoked"] as const;
export const grantStateSchema = z.enum(grantStates);
export type GrantState = z.infer<typeof grantStateSchema>;

export const projectedGrantStates = ["provisioning", ...grantStates] as const;
export const projectedGrantStateSchema = z.enum(projectedGrantStates);
export type ProjectedGrantState = z.infer<typeof projectedGrantStateSchema>;

const conversionBaseSchema = z.object({
  conversionId: uuidV4Schema,
  sourceUrl: sourceUrlSchema,
  title: z.string().min(1).optional(),
  acceptedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().optional(),
});

export const grantConversionSnapshotSchema = z.discriminatedUnion("status", [
  conversionBaseSchema.extend({ status: z.literal("pending") }).strict(),
  conversionBaseSchema
    .extend({
      status: z.literal("ready"),
      completedAt: z.iso.datetime(),
      audiobookUrl: z.string().regex(AUDIOBOOK_PATH_PATTERN),
    })
    .strict(),
  conversionBaseSchema
    .extend({
      status: z.literal("failed"),
      completedAt: z.iso.datetime(),
      failure: z
        .object({ category: conversionFailureCategorySchema, explanation: z.string().min(1) })
        .strict(),
    })
    .strict(),
]);
export type GrantConversionSnapshot = z.infer<typeof grantConversionSnapshotSchema>;
export const grantConversionsSchema = z.array(grantConversionSnapshotSchema);
export type GrantConversions = z.infer<typeof grantConversionsSchema>;

export const grantSnapshotSchema = z
  .object({
    grantId: uuidV4Schema,
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().optional(),
    state: grantStateSchema,
    duration: durationBalanceSchema,
  })
  .strict();
export type GrantSnapshot = z.infer<typeof grantSnapshotSchema>;

export const operatorGrantSnapshotSchema = grantSnapshotSchema
  .extend({
    allowanceMilliseconds: z.number().int().positive(),
    conversions: z.array(
      z.discriminatedUnion("status", [
        conversionBaseSchema
          .extend({
            status: z.literal("pending"),
            idempotencyKey: uuidV4Schema,
            workflowId: uuidV4Schema,
            reconciliation: reconciliationSchema(),
          })
          .strict(),
        conversionBaseSchema
          .extend({
            status: z.literal("ready"),
            completedAt: z.iso.datetime(),
            idempotencyKey: uuidV4Schema,
            workflowId: uuidV4Schema,
            audiobookUrl: z.string().regex(AUDIOBOOK_PATH_PATTERN),
            measurements: z
              .object({
                narrationTextCharacters: z.number().int().nonnegative(),
                narrationChunks: z.number().int().nonnegative(),
              })
              .strict()
              .optional(),
            providerUsage: z.record(z.string(), z.unknown()).optional(),
            reconciliation: reconciliationSchema(),
          })
          .strict(),
        conversionBaseSchema
          .extend({
            status: z.literal("failed"),
            completedAt: z.iso.datetime(),
            idempotencyKey: uuidV4Schema,
            workflowId: uuidV4Schema,
            failure: z
              .object({
                category: conversionFailureCategorySchema,
                explanation: z.string().min(1),
              })
              .strict(),
            diagnosticReference: z.string().max(500).optional(),
            cleanupState: z.enum(["pending", "complete", "cleanup_failed"]).optional(),
            reconciliation: reconciliationSchema(),
          })
          .strict(),
      ]),
    ),
    signingKeyGeneration: z.number().int().positive(),
    registrySnapshotRevision: z.number().int().positive(),
    registryConfirmedSnapshotRevision: z.number().int().nonnegative(),
  })
  .strict();
export type OperatorGrantSnapshot = z.infer<typeof operatorGrantSnapshotSchema>;

export type OperatorGrantFacts = {
  grantId: string;
  requestId: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  state: ProjectedGrantState;
};

export type ListGrantsResult = {
  grants: OperatorGrantFacts[];
  nextCursor?: string;
};

export type GrantMigrationReport = {
  complete: boolean;
  registryVersion: number;
  grants: Array<{
    grantId: string;
    success: boolean;
    schemaVersion?: number;
    error?: string;
  }>;
};

function reconciliationSchema() {
  return z
    .object({
      state: z.enum(["unconfirmed", "confirmed", "cutoff-ambiguous"]),
      workflowStartedAt: z.iso.datetime().optional(),
    })
    .strict();
}
