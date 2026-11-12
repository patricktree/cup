/* oxlint-disable node/no-process-env -- The fixture reads the certificate paths from global setup and honors debug flags. */
import { expect as baseExpect, test as base } from "@playwright/test";
import type { Locator, Page, TestInfo } from "@playwright/test";
import fs from "node:fs/promises";

import {
  startAuthProvider,
  startTestWorker,
  type AuthProvider,
  type CreatedGrant,
  type TestWorkerScenario,
} from "@cup/test-worker";

import { VISUAL_TAG } from "#test-e2e/browser-project-tags.ts";
import {
  HTTPS_CERT_PATH_ENV_VAR_NAME,
  HTTPS_KEY_PATH_ENV_VAR_NAME,
} from "#test-e2e/https-certificate.global-setup.ts";

export type WorkerEnvironment = {
  origin: string;
  /** This test's fake auth provider: its recorded authorization requests and token lifetime. */
  authProvider: AuthProvider;
  persistenceDirectory: string;
  createGrant(): Promise<CreatedGrant>;
  restart(scenario: TestWorkerScenario): Promise<void>;
};

type Fixtures = {
  expectConsoleError: ((message: string | RegExp) => void) & { messages: Array<string | RegExp> };
  qaScenario: TestWorkerScenario;
  /** Whether the Worker offers the fake auth provider's test account, as local development does. */
  offersTestAccount: boolean;
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
  offersTestAccount: [false, { option: true }],
  workerEnvironment: async ({ qaScenario, offersTestAccount }, use, testInfo) => {
    const environment = await createWorkerEnvironment(qaScenario, offersTestAccount);

    try {
      await use(environment);
    } finally {
      await environment.dispose(testInfo);
    }
  },
  page: async ({ browserName, expectConsoleError, page, workerEnvironment }, use, testInfo) => {
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
    // WebKit rejects the outgoing document's pending loads when a navigation replaces it: it raises
    // each cancelled fetch as failing "due to access control checks", and the queries' error
    // boundaries and Vite's preload helper log errors nobody can see. Chromium drops that document's
    // pending loads silently. Errors between a main-frame document request and the commit of the next
    // document come from the outgoing document, because the next one has run no script yet. They are
    // attached to the report but not counted. Chromium keeps the full check.
    const outgoingDocumentErrors: string[] = [];
    let isReplacingDocument = false;
    const recordError = (errors: string[], text: string): void => {
      if (browserName === "webkit" && isReplacingDocument) {
        outgoingDocumentErrors.push(text);
      } else {
        errors.push(text);
      }
    };
    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        isReplacingDocument = true;
      }
    });
    page.on("requestfailed", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        isReplacingDocument = false;
      }
    });
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        isReplacingDocument = false;
      }
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        recordError(consoleErrors, message.text());
      }
    });
    page.on("pageerror", (error) => recordError(pageErrors, error.message));

    await use(page);

    await attachText(testInfo, "outgoing-document-errors", outgoingDocumentErrors);
    await attachText(testInfo, "browser-console-errors", consoleErrors);
    await attachText(testInfo, "browser-page-errors", pageErrors);
    baseExpect(unexpectedRequests, "The browser made an unapproved external request").toEqual([]);
    // A test may expect an error when its route answers a request, before the browser logs it.
    await baseExpect(() => {
      baseExpect(
        consoleErrors,
        "The browser logged an unexpected number of console errors",
      ).toHaveLength(expectConsoleError.messages.length);
    }).toPass({ timeout: 5_000 });
    for (const [index, expectedMessage] of expectConsoleError.messages.entries()) {
      const actualMessage = consoleErrors[index];
      baseExpect(actualMessage, `Unexpected browser console error at index ${index}`).toBeDefined();
      if (typeof expectedMessage === "string") {
        baseExpect(actualMessage).toBe(expectedMessage);
      } else {
        baseExpect(actualMessage).toMatch(expectedMessage);
      }
    }
    baseExpect(pageErrors, "The browser raised page errors").toEqual([]);
  },
});

/**
 * Playwright's `expect`, whose `toHaveScreenshot` fails in a test without {@link VISUAL_TAG}, so a
 * screenshot cannot silently lose the two browser projects that run only visual tests.
 */
export const expect = baseExpect.extend({
  async toHaveScreenshot(receiver: Locator | Page, name: string) {
    if (!test.info().tags.includes(VISUAL_TAG)) {
      return {
        name: "toHaveScreenshot",
        pass: false,
        message: () =>
          `Tag a test that asserts a screenshot with "${VISUAL_TAG}", so that it runs in all four browser projects: test(title, { tag: "${VISUAL_TAG}" }, body).`,
      };
    }

    await (isPage(receiver)
      ? baseExpect(receiver).toHaveScreenshot(name)
      : baseExpect(receiver).toHaveScreenshot(name));
    return { name: "toHaveScreenshot", pass: true, message: () => "" };
  },
});

function isPage(receiver: Locator | Page): receiver is Page {
  return "goto" in receiver;
}

type InternalWorkerEnvironment = WorkerEnvironment & {
  dispose(testInfo: TestInfo): Promise<void>;
};

async function createWorkerEnvironment(
  initialScenario: TestWorkerScenario,
  offersTestAccount: boolean,
): Promise<InternalWorkerEnvironment> {
  const httpsKeyPath = readRequiredEnvironmentVariable(HTTPS_KEY_PATH_ENV_VAR_NAME);
  const httpsCertPath = readRequiredEnvironmentVariable(HTTPS_CERT_PATH_ENV_VAR_NAME);
  const authProvider = await startAuthProvider({
    tls: { key: await fs.readFile(httpsKeyPath), cert: await fs.readFile(httpsCertPath) },
  });
  const worker = await startTestWorker({
    scenario: initialScenario,
    authProviderOrigin: authProvider.origin,
    offersTestAccount,
    https: { keyPath: httpsKeyPath, certPath: httpsCertPath },
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

function readRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} is not set; it comes from \`test-e2e/https-certificate.global-setup.ts\`, which the Playwright config runs.`,
    );
  }
  return value;
}

export async function gotoPage(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await waitForFonts(page);
}

async function waitForFonts(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
}
