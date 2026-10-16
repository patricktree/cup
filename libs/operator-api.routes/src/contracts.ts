import { z } from "zod";

import {
  accountAccountingInspectionSchema,
  accountArtifactWriterSchema,
  accountDurationBalanceSchema,
  accountHistoryPageSchema,
  accountSnapshotSchema,
} from "@cup/accounts/contracts";
import {
  grantSnapshotSchema,
  operatorGrantSnapshotSchema,
  projectedGrantStates,
  projectedGrantStateSchema,
  type GrantMigrationReport,
  type OperatorGrantFacts,
  type ProjectedGrantState,
} from "@cup/conversion-grants/contracts";

const LOWERCASE_UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export { projectedGrantStates };
export type { GrantMigrationReport, OperatorGrantFacts, ProjectedGrantState };

export const uuidV4Schema = z
  .string()
  .regex(LOWERCASE_UUID_V4_PATTERN, "Must be a lowercase UUIDv4");
export const grantParamsSchema = z.object({ grantId: uuidV4Schema }).strict();
export type GrantParams = z.infer<typeof grantParamsSchema>;

export const createGrantRequestSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1)
      .refine(
        (value) => Array.from(value).length <= 120,
        "Label must contain at most 120 code points",
      ),
    requestId: uuidV4Schema,
  })
  .strict();
export type CreateGrantRequest = z.infer<typeof createGrantRequestSchema>;

const operatorGrantFactsSchema = z
  .object({
    grantId: uuidV4Schema,
    requestId: uuidV4Schema,
    label: z.string().min(1),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    state: projectedGrantStateSchema,
  })
  .strict();
export const createGrantResponseSchema = z.discriminatedUnion("result", [
  operatorGrantFactsSchema.extend({ result: z.literal("issued"), trialLink: z.url() }).strict(),
  operatorGrantFactsSchema.extend({ result: z.literal("already-issued") }).strict(),
]);
export type CreateGrantResponse = z.infer<typeof createGrantResponseSchema>;

export const listGrantsQuerySchema = z
  .object({
    label: z.string().trim().min(1).optional(),
    state: projectedGrantStateSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).optional(),
  })
  .strict();
export type ListGrantsQuery = z.input<typeof listGrantsQuerySchema>;
export const listGrantsResponseSchema = z
  .object({ grants: z.array(operatorGrantFactsSchema), nextCursor: z.string().optional() })
  .strict();
export type ListGrantsResponse = z.infer<typeof listGrantsResponseSchema>;

export const operatorInspectResponseSchema = z
  .object({
    registry: operatorGrantFactsSchema,
    authoritative: operatorGrantSnapshotSchema,
    registrySnapshotDisagreement: z.boolean(),
  })
  .strict();
export type OperatorInspectResponse = z.infer<typeof operatorInspectResponseSchema>;

export const revokeGrantResponseSchema = z
  .object({ changed: z.boolean(), grant: grantSnapshotSchema })
  .strict();
export type RevokeGrantResponse = z.infer<typeof revokeGrantResponseSchema>;
export const invalidateSessionsRequestSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1)
      .refine(
        (value) => Array.from(value).length <= 500,
        "Reason must contain at most 500 code points",
      ),
  })
  .strict();
export const invalidateSessionsResponseSchema = z
  .object({ invalidatedAt: z.iso.datetime(), grant: grantSnapshotSchema })
  .strict();
export type InvalidateSessionsResponse = z.infer<typeof invalidateSessionsResponseSchema>;
export const migrationReportSchema = z
  .object({
    complete: z.boolean(),
    registryVersion: z.number().int().positive(),
    grants: z.array(
      z
        .object({
          grantId: uuidV4Schema,
          success: z.boolean(),
          schemaVersion: z.number().int().positive().optional(),
          error: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict();

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

export const setGrantAllowanceRequestSchema = z
  .object({ allowanceMilliseconds: z.number().int().positive() })
  .strict();

export const accountParamsSchema = z.object({ accountId: z.uuid() }).strict();
export type AccountParams = z.infer<typeof accountParamsSchema>;

// The account owns these shapes and its Durable Object returns them, so the operator contract
// composes the account schemas instead of keeping copies that can drift from the account.
export const inspectAccountResponseSchema = z
  .object({
    account: accountSnapshotSchema,
    accounting: accountAccountingInspectionSchema,
    history: accountHistoryPageSchema,
    writers: z.array(accountArtifactWriterSchema),
  })
  .strict();
export type InspectAccountResponse = z.infer<typeof inspectAccountResponseSchema>;

export const listAccountDeletionsResponseSchema = z
  .object({
    attempts: z.array(
      z
        .object({
          attemptId: z.uuid(),
          accountId: z.uuid(),
          state: z.enum(["scheduled", "restored", "deleting", "erased"]),
          identityDone: z.boolean(),
          accountDone: z.boolean(),
          failures: z.number().int(),
          overdue: z.boolean(),
        })
        .strict(),
    ),
    receipts: z.array(
      z
        .object({
          attemptId: z.uuid(),
          completedAtMs: z.number(),
          expiresAtMs: z.number(),
          result: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export type ListAccountDeletionsResponse = z.infer<typeof listAccountDeletionsResponseSchema>;

export const accountPhases = ["provisioning", "active", "deleting_identity"] as const;
export const listAccountsQuerySchema = z
  .object({
    phase: z.enum(accountPhases).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).optional(),
  })
  .strict();
export type ListAccountsQuery = z.input<typeof listAccountsQuerySchema>;
export const listAccountsResponseSchema = z
  .object({
    accounts: z.array(
      z
        .object({
          accountId: z.uuid(),
          subject: z.uuid(),
          createdAt: z.iso.datetime(),
          phase: z.enum(accountPhases),
          // Absent until the Registry has received the account's first usage projection.
          usage: z
            .object({
              allowanceMilliseconds: z.number().int().nonnegative(),
              reservedMilliseconds: z.number().int().nonnegative(),
              spentMilliseconds: z.number().int().nonnegative(),
              availableMilliseconds: z.number().int().nonnegative(),
            })
            .strict()
            .optional(),
        })
        .strict(),
    ),
    nextCursor: z.string().optional(),
  })
  .strict();
export type ListAccountsResponse = z.infer<typeof listAccountsResponseSchema>;

export const adjustAccountAllowanceRequestSchema = z
  .object({
    requestId: uuidV4Schema,
    amountMilliseconds: z
      .number()
      .int()
      .safe()
      .refine((value) => value !== 0, "Amount must not be zero"),
    reason: z.string().trim().min(1).max(256),
  })
  .strict();
export type AdjustAccountAllowanceRequest = z.infer<typeof adjustAccountAllowanceRequestSchema>;
export const adjustAccountAllowanceResponseSchema = z
  .object({ accountId: z.uuid(), balance: accountDurationBalanceSchema })
  .strict();
export type AdjustAccountAllowanceResponse = z.infer<typeof adjustAccountAllowanceResponseSchema>;
