// Checks that the host has every tool both platforms' runs need, without starting a run, and
// prints every problem with its fix. Each platform's global setup runs its own check again.
import { checkAndroidHost } from "#src/android/preflight.ts";
import { checkIosHost } from "#src/ios/preflight.ts";

const results = await Promise.allSettled([checkAndroidHost(), checkIosHost()]);
for (const result of results) {
  if (result.status === "rejected") {
    console.error(result.reason instanceof Error ? result.reason.message : result.reason);
    process.exitCode = 1;
  }
}
