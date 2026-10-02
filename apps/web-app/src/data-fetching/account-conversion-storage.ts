import { z } from "zod";

import { sourceUrlSchema } from "@cup/web-app-api.routes";

const PENDING_CONVERSION_KEY = "cup_pending_conversion";

const requestSchema = z.object({
  sourceUrl: sourceUrlSchema,
  idempotencyKey: z.uuidv4(),
  submitted: z.boolean(),
});
export type PendingAccountConversion = z.infer<typeof requestSchema>;

export function readPendingAccountConversion() {
  const value = window.sessionStorage.getItem(PENDING_CONVERSION_KEY);
  if (!value) return null;
  try {
    return requestSchema.parse(JSON.parse(value));
  } catch {
    clearPendingAccountConversion();
    return null;
  }
}

export function storePendingAccountConversion(request: z.infer<typeof requestSchema>): void {
  window.sessionStorage.setItem(PENDING_CONVERSION_KEY, JSON.stringify(request));
}

export function clearPendingAccountConversion(): void {
  window.sessionStorage.removeItem(PENDING_CONVERSION_KEY);
}
