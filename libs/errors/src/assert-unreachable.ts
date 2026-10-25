/**
 * Ends an exhaustive `switch` or if-chain over a union: a missed case fails to compile, and a value
 * outside the union that arrives at runtime anyway throws instead of taking a silent fallback.
 */
export function assertUnreachable(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
