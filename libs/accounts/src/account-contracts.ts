import { z } from "zod";

import type { AudiobookReference } from "@cup/conversion-contracts";

export const accountIdentitySchema = z
  .object({
    accountId: z.uuidv4(),
    subject: z.uuid(),
    createdAtMs: z.number().int().nonnegative().safe(),
  })
  .strict();

export type AccountIdentity = z.infer<typeof accountIdentitySchema>;
export type AccountSnapshot = AccountIdentity & {
  state: "active" | "deletion_scheduled" | "deleting";
  executionEpoch: number;
  recoveryDeadlineMs: number | null;
  balance: { unit: "audio-millisecond"; available: number; reserved: number };
};
export type AccountConversion = {
  conversionId: string;
  idempotencyKey: string;
  sourceUrl: string;
  createdAtMs: number;
  status: "pending" | "ready" | "failed";
};
export type AccountConversionOutcome =
  | { status: "ready"; title: string; audiobookReference: AudiobookReference }
  | { status: "failed"; failureCategory: string; explanation: string };

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

export type AccountWorkflowParams = {
  v: 2;
  sourceUrl: string;
  owner: { kind: "account"; accountId: string };
  conversionId: string;
  executionEpoch: number;
};
