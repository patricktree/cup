/*
 * Logs of a caught error carry only its root cause, the error that actually went wrong, plus the
 * log line's own context. Wrapping errors add no diagnosis, and some, such as Drizzle's query
 * errors, embed SQL parameters or request data, which must never be logged.
 */

/**
 * The innermost value of an error's `cause` chain: the first value that is not an `Error` with a
 * cause. A chain that loops back on itself ends at the last error before the repetition.
 */
export function findRootCause(error: unknown): unknown {
  const visited = new Set<unknown>([error]);
  let current = error;
  while (current instanceof Error && current.cause !== undefined && !visited.has(current.cause)) {
    current = current.cause;
    visited.add(current);
  }
  return current;
}

/** The message of an error's root cause, for log lines that add their own context. */
export function findRootCauseMessage(error: unknown): string {
  const rootCause = findRootCause(error);
  return rootCause instanceof Error ? rootCause.message : String(rootCause);
}

/** The name and message of an error's root cause, for log lines that also report the error type. */
export function findRootCauseDescription(error: unknown): string {
  const rootCause = findRootCause(error);
  return rootCause instanceof Error ? `${rootCause.name}: ${rootCause.message}` : String(rootCause);
}
