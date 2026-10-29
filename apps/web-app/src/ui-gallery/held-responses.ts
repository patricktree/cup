import { check } from "@patricktree-stack/utils-ecma/assert.utils";

/**
 * Lets a test hold a story's mocked responses, for example a refetch, until it has checked what the
 * screen shows from the cache meanwhile. A story handler awaits `waitWhileHeld` with a name; a test
 * calls `window.holdResponses` and `window.releaseResponses` with that name, which a story that
 * imports this module provides.
 */
const holds = new Map<string, { promise: Promise<void>; release: () => void }>();

export function holdResponses(name: string): void {
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

function releaseResponses(name: string): void {
  holds.get(name)?.release();
  holds.delete(name);
}

Object.assign(window, { holdResponses, releaseResponses });

export async function waitWhileHeld(name: string): Promise<void> {
  await holds.get(name)?.promise;
}
