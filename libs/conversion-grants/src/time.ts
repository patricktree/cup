import { Temporal } from "temporal-polyfill";

export function toIsoString(epochMilliseconds: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds).toString();
}
