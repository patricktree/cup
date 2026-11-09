/* oxlint-disable node/no-process-env -- The fixture honors debug flags. */
import { expect, test as base } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

import {
  startAuthProvider,
  startTestWorker,
  type CreatedGrant,
  type TestWorkerScenario,
} from "@cup/test-worker";

export type WorkerEnvironment = {
  origin: string;
  authProvider: Awaited<ReturnType<typeof startAuthProvider>>;
  persistenceDirectory: string;
  createGrant(): Promise<CreatedGrant>;
  restart(scenario: TestWorkerScenario): Promise<void>;
};

type Fixtures = {
  expectConsoleError: ((message: string | RegExp) => void) & { messages: Array<string | RegExp> };
  qaScenario: TestWorkerScenario;
  workerEnvironment: WorkerEnvironment;
};

export const test = base.extend<Fixtures>({
  expectConsoleError: async ({ browserName: _browserName }, use) => {
    const expectedConsoleErrors: Array<string | RegExp> = [];
    await use(
      Object.assign((message: string | RegExp) => void expectedConsoleErrors.push(message), {
        messages: expectedConsoleErrors,
      }),
    );
  },
  qaScenario: ["success", { option: true }],
  workerEnvironment: async ({ qaScenario }, use, testInfo) => {
    const environment = await createWorkerEnvironment(qaScenario);

    try {
      await use(environment);
    } finally {
      await environment.dispose(testInfo);
    }
  },
  page: async ({ expectConsoleError, page, workerEnvironment }, use, testInfo) => {
    const unexpectedRequests: string[] = [];
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (
        url.origin === workerEnvironment.origin ||
        url.origin === workerEnvironment.authProvider.origin ||
        url.protocol === "data:" ||
        url.protocol === "blob:"
      ) {
        await route.continue();
        return;
      }

      unexpectedRequests.push(url.href);
      await route.abort("blockedbyclient");
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await use(page);

    await attachText(testInfo, "browser-console-errors", consoleErrors);
    await attachText(testInfo, "browser-page-errors", pageErrors);
    expect(unexpectedRequests, "The browser made an unapproved external request").toEqual([]);
    // A test may expect an error when its route answers a request, before the browser logs it.
    await expect(() => {
      expect(
        consoleErrors,
        "The browser logged an unexpected number of console errors",
      ).toHaveLength(expectConsoleError.messages.length);
    }).toPass({ timeout: 5_000 });
    for (const [index, expectedMessage] of expectConsoleError.messages.entries()) {
      const actualMessage = consoleErrors[index];
      expect(actualMessage, `Unexpected browser console error at index ${index}`).toBeDefined();
      if (typeof expectedMessage === "string") {
        expect(actualMessage).toBe(expectedMessage);
      } else {
        expect(actualMessage).toMatch(expectedMessage);
      }
    }
    expect(pageErrors, "The browser raised page errors").toEqual([]);
  },
});

export { expect } from "@playwright/test";

type InternalWorkerEnvironment = WorkerEnvironment & {
  dispose(testInfo: TestInfo): Promise<void>;
};

async function createWorkerEnvironment(
  initialScenario: TestWorkerScenario,
): Promise<InternalWorkerEnvironment> {
  const authProvider = await startAuthProvider();
  const worker = await startTestWorker({
    scenario: initialScenario,
    authProviderOrigin: authProvider.origin,
    streamLogs: process.env["E2E_STREAM_WRANGLER"] === "1",
  });

  return {
    origin: worker.origin,
    authProvider,
    persistenceDirectory: worker.persistenceDirectory,
    createGrant: () => worker.createGrant(),
    restart: (scenario) => worker.restart(scenario),
    async dispose(currentTestInfo) {
      const didFail = currentTestInfo.status !== currentTestInfo.expectedStatus;
      const shouldRetain = didFail && process.env["E2E_RETAIN_STATE"] === "1";
      await worker.stop({ retainPersistenceDirectory: shouldRetain });
      await authProvider.close();
      await attachText(currentTestInfo, "wrangler-output", [...worker.logs]);
      if (shouldRetain) {
        await currentTestInfo.attach("retained-worker-state", {
          body: worker.persistenceDirectory,
          contentType: "text/plain",
        });
      }
    },
  };
}

async function attachText(testInfo: TestInfo, name: string, lines: string[]): Promise<void> {
  if (lines.length === 0) {
    return;
  }
  await testInfo.attach(name, { body: lines.join("\n"), contentType: "text/plain" });
}

export async function gotoPage(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await waitForFonts(page);
}

async function waitForFonts(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
}
