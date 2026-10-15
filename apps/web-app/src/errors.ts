// The class api-request.ts re-exports; importing that module would cycle back to the query client.
import { RpcError } from "@cup/web-app-api.client";

/** The wording of a failure: what failed, and why when that is known. */
export type ErrorCopy = { title: string; detail: string | undefined };

/** What the user is told about a failure, shared by error screens and error toasts. */
type ErrorDescription = ErrorCopy & { isRetryable: boolean };

/** Words a lasting API refusal in terms of the page it occurs on. */
export type DescribeApiRefusal = (error: RpcError) => ErrorCopy;

/** A failure detected in the app whose wording is decided where it is thrown. */
export class UserFacingError extends Error {
  readonly title: string;
  readonly detail: string | undefined;

  constructor({ title, detail }: { title: string; detail?: string }) {
    super(detail === undefined ? title : `${title} ${detail}`);
    this.name = "UserFacingError";
    this.title = title;
    this.detail = detail;
  }
}

/**
 * Describes a failure for the user. `fallbackTitle` names what failed from the caller's point of
 * view and is used whenever the error itself carries no title.
 */
export function describeError(
  error: unknown,
  fallbackTitle: string,
  describeApiRefusal?: DescribeApiRefusal,
): ErrorDescription {
  if (error instanceof UserFacingError) {
    return { title: error.title, detail: error.detail, isRetryable: false };
  }

  if (error instanceof RpcError && error.status < 500) {
    // The API words refusals for users; only rate limiting goes away by trying again.
    if (error.status === 429) {
      return { title: fallbackTitle, detail: error.message, isRetryable: true };
    }

    const refusal = describeApiRefusal?.(error) ?? { title: fallbackTitle, detail: error.message };
    return { ...refusal, isRetryable: false };
  }

  // Server failures, lost connections, and app bugs carry no message meant for users.
  return { title: fallbackTitle, detail: undefined, isRetryable: true };
}

/** One line about a failure for text shown next to the control that failed. */
export function summarizeError(error: unknown, fallbackTitle: string): string {
  const description = describeError(error, fallbackTitle);
  return description.detail ?? description.title;
}
