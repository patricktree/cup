import { Temporal } from "temporal-polyfill";

export function nowMilliseconds(): number {
  return Temporal.Now.instant().epochMilliseconds;
}
