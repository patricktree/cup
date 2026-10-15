import React from "react";
import { Temporal } from "temporal-polyfill";

import { RpcError } from "#src/data-fetching/api-request.js";

/** Expiration enables a manual retry; it never submits a saved URL automatically. */
export function useRateLimitCountdown(error: unknown) {
  const [nowMs, setNowMs] = React.useState(() => Temporal.Now.instant().epochMilliseconds);
  const { seconds, deadline } = React.useMemo(() => {
    const duration = error instanceof RpcError && error.status === 429 ? error.retryAfter : 0;
    return {
      seconds: duration,
      deadline: Temporal.Now.instant().epochMilliseconds + duration * 1000,
    };
  }, [error]);
  React.useEffect(() => {
    if (!seconds) {
      return undefined;
    }
    const timer = window.setInterval(
      () => setNowMs(Temporal.Now.instant().epochMilliseconds),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [seconds]);
  return seconds ? Math.min(seconds, Math.max(0, Math.ceil((deadline - nowMs) / 1000))) : 0;
}
