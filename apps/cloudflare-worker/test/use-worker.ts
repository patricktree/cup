import nodeUrl from "node:url";
import type { TestContext } from "vitest";
import { createTestHarness, type WorkerHandle } from "wrangler";

import type { ApiServerEnvironment } from "@cup/api-server";

import type * as testWorkerModule from "#test/worker.ts";

export type TestWorker = WorkerHandle<ApiServerEnvironment, typeof testWorkerModule>;

type UseWorkerOptions = Pick<TestContext, "onTestFinished"> & {
  /** Test-only vars that override wrangler.test.jsonc, for example `LOCAL_DEVELOPMENT`. */
  vars?: Record<string, string>;
  /** Test-only secrets that override the dummy values of `TEST_SECRETS`. */
  secrets?: Record<string, string>;
};

const PACKAGE_DIRECTORY = nodeUrl.fileURLToPath(new URL("..", import.meta.url));

/**
 * Dummy values for every secret of `secrets.required` in wrangler.jsonc. None of them is valid for
 * a real provider, and wrangler.test.jsonc points the providers' URLs at an unreachable address.
 */
export const TEST_SECRETS = {
  CLOUDFLARE_API_KEY: "test-cloudflare-api-key",
  SOURCE_PAGE_COOKIES_JSON: "[]",
  SUPABASE_SECRET_KEY: "test-supabase-secret-key",
  SUPABASE_PUBLISHABLE_KEY: "test-supabase-publishable-key",
  GOOGLE_WEB_CLIENT_ID: "test-google-web-client-id",
  RESEND_API_KEY: "test-resend-api-key",
} as const;

/**
 * Starts a fresh instance of the whole production Worker (test/worker.ts) in Wrangler's local test
 * runtime, with empty Durable Object, R2 and Workflow storage, and closes it when the test
 * finishes.
 *
 * Pass `onTestFinished` from the test's own context: Vitest tracks hooks per test only through the
 * context, which keeps concurrent tests in one file apart.
 */
export async function useWorker({
  onTestFinished,
  vars = {},
  secrets = {},
}: UseWorkerOptions): Promise<TestWorker> {
  const testRuntime = createTestHarness({
    root: PACKAGE_DIRECTORY,
    workers: [
      {
        configPath: "./test/wrangler.test.jsonc",
        vars,
        secrets: { ...TEST_SECRETS, ...secrets },
      },
    ],
  });
  onTestFinished(() => testRuntime.close());

  await testRuntime.listen();

  return testRuntime.getWorker<ApiServerEnvironment, typeof testWorkerModule>();
}
