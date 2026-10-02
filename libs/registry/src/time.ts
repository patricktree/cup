import { Temporal } from "temporal-polyfill";

export function nowMilliseconds(): number {
  return Temporal.Now.instant().epochMilliseconds;
}

export function toIsoString(epochMilliseconds: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds).toString();
}
