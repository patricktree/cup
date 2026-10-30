import { check } from "@patricktree-stack/utils-ecma/assert.utils";
import { HttpResponse } from "msw";

import type { ErrorResponse } from "@cup/listener-api.routes";

/**
 * Lets a test hold or fail a story's mocked responses, for example a refetch, to check what the
 * screen shows from the cache meanwhile or after the refetch failed. A story handler awaits
 * `waitWhileHeld` with a name and answers `readFailedStoryResponse` when it returns one; a test
 * calls `window.holdResponses`, `window.releaseResponses` and `window.failResponses` with that name
 * (through `src/test-utils/held-responses.ts`), which a story that imports this module provides.
 */
type FailureStatus = 403 | 404 | 500;

const ERROR_OF_STATUS = {
  403: { code: "grant-revoked", message: "This trial was revoked." },
  404: { code: "not-found", message: "Not found." },
  500: { code: "operational-error", message: "The request could not be completed." },
} as const satisfies Record<FailureStatus, Omit<ErrorResponse["error"], "requestId">>;

const holds = new Map<string, { promise: Promise<void>; release: () => void }>();
const failures = new Map<string, FailureStatus>();

export function holdStoryResponses(name: string): void {
  if (holds.has(name)) {
    return;
  }

  let release: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  check.assert(release, "A promise executor runs synchronously.");
  holds.set(name, { promise, release });
}

function releaseStoryResponses(name: string): void {
  holds.get(name)?.release();
  holds.delete(name);
}

/** Every later response of that name fails with the status, for the rest of the page's lifetime. */
function failStoryResponses(name: string, status: FailureStatus): void {
  failures.set(name, status);
}

Object.assign(window, {
  holdResponses: holdStoryResponses,
  releaseResponses: releaseStoryResponses,
  failResponses: failStoryResponses,
});

export async function waitWhileHeld(name: string): Promise<void> {
  await holds.get(name)?.promise;
}

/** The error response a test asked responses of that name to fail with, if any. */
export function readFailedStoryResponse(name: string): HttpResponse<ErrorResponse> | undefined {
  const status = failures.get(name);
  if (status === undefined) {
    return undefined;
  }

  return HttpResponse.json(
    {
      error: {
        requestId: "09e6d824-d41d-43bb-9417-18f89232ba56",
        ...ERROR_OF_STATUS[status],
      },
    } satisfies ErrorResponse,
    { status },
  );
}
