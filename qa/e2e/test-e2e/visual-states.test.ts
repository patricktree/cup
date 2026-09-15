import type { Page, Route } from "@playwright/test";

import { expect, gotoPage, test } from "#test-e2e/fixtures.ts";

const GRANT_ID = "b4ad28a8-bbd7-46af-a17c-59527becd745";
const CONVERSION_ID = "693af4c4-9fa8-430d-9dc5-c00e88fb38a7";
const CREDENTIAL = `v1.${"a".repeat(43)}`;
const SOURCE_URL = "https://source.example.test/fixture";
const REQUEST_ID = "09e6d824-d41d-43bb-9417-18f89232ba56";
const CONSOLE_ERRORS = {
  unauthorized: "Failed to load resource: the server responded with a status of 401 (Unauthorized)",
  forbidden: "Failed to load resource: the server responded with a status of 403 (Forbidden)",
  notFound: "Failed to load resource: the server responded with a status of 404 (Not Found)",
  serverError:
    "Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
  unavailable:
    "Failed to load resource: the server responded with a status of 503 (Service Unavailable)",
} as const;

test("shows the public portfolio page", async ({ page, workerEnvironment }) => {
  await gotoPage(page, workerEnvironment.origin);

  await expect(page.getByRole("heading", { name: "Cup" })).toBeVisible();
  await expect(page.getByRole("link", { name: "GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/patricktree/create-audiobook-from-url",
  );
  await expect(
    page.getByText(/Conversions are available only through a supplied trial link/),
  ).toBeVisible();
});

test("shows the open trial URL input screen", async ({ page, workerEnvironment }) => {
  await mockCredentialExchange(page, workerEnvironment.origin);
  await gotoPage(page, trialLink(workerEnvironment.origin));

  await expect(page.getByRole("heading", { name: "Just Listen." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load & listen" })).toBeDisabled();
  await expect(page).toHaveScreenshot("initial.png");
});

test("rejects malformed and invalid trial links", async ({
  expectConsoleError,
  page,
  workerEnvironment,
}) => {
  expectConsoleError(/^TrialLinkInvalidError: This trial link is invalid\./);
  await gotoPage(page, `${workerEnvironment.origin}/app/trials/${GRANT_ID}#credential=malformed`);
  await expect(page.getByRole("heading", { name: "This trial link is invalid." })).toBeVisible();

  await gotoPage(page, workerEnvironment.origin);
  await page.route(`${workerEnvironment.origin}/api/grants/${GRANT_ID}/sessions`, async (route) => {
    await fulfillError(route, 401, "invalid-grant-credential", "The grant credential is invalid.");
  });
  expectConsoleError(CONSOLE_ERRORS.unauthorized);
  expectConsoleError(/^ApiError: The grant credential is invalid\./);
  await gotoPage(page, trialLink(workerEnvironment.origin));
  await expect(page.getByRole("heading", { name: "This trial link is invalid." })).toBeVisible();
});

test("shows a revoked trial link", async ({ expectConsoleError, page, workerEnvironment }) => {
  await page.route(`${workerEnvironment.origin}/api/grants/${GRANT_ID}/sessions`, async (route) => {
    await fulfillError(route, 403, "grant-revoked", "The grant was revoked.");
  });
  expectConsoleError(CONSOLE_ERRORS.forbidden);
  expectConsoleError(/^ApiError: The grant was revoked\./);

  await gotoPage(page, trialLink(workerEnvironment.origin));
  await expect(page.getByRole("heading", { name: "This trial link was revoked." })).toBeVisible();
});

test("recovers from an operational credential exchange error", async ({
  expectConsoleError,
  page,
  workerEnvironment,
}) => {
  let exchangeAttempts = 0;
  await page.route(`${workerEnvironment.origin}/api/grants/${GRANT_ID}/sessions`, async (route) => {
    exchangeAttempts += 1;
    if (exchangeAttempts === 1) {
      await fulfillError(route, 503, "dependency-unavailable", "The service is unavailable.");
      return;
    }
    await fulfillJson(route, 201, createGrant());
  });
  await mockGrant(page, workerEnvironment.origin);
  expectConsoleError(CONSOLE_ERRORS.unavailable);
  expectConsoleError(/^ApiError: The service is unavailable\./);

  await gotoPage(page, trialLink(workerEnvironment.origin));
  await expect(
    page.getByRole("heading", { name: "The trial link could not be opened." }),
  ).toBeVisible();
  await expect(page).toHaveURL(trialLink(workerEnvironment.origin));

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Just Listen." })).toBeVisible();
  expect(exchangeAttempts).toBe(1);
});

test("retries an initial grant loading failure", async ({
  expectConsoleError,
  page,
  workerEnvironment,
}) => {
  let grantAttempts = 0;
  await page.route(`${workerEnvironment.origin}/api/grants/${GRANT_ID}`, async (route) => {
    grantAttempts += 1;
    if (grantAttempts === 1) {
      await fulfillError(route, 500, "operational-error", "The Trial could not be loaded.");
      return;
    }
    await fulfillJson(route, 200, createGrant());
  });
  expectConsoleError(CONSOLE_ERRORS.serverError);
  expectConsoleError(/^ApiError: The Trial could not be loaded\./);

  await gotoPage(page, `${workerEnvironment.origin}/app/trials/${GRANT_ID}`);
  await expect(
    page.getByRole("heading", { name: "The trial link could not be opened." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Just Listen." })).toBeVisible();
  expect(grantAttempts).toBeGreaterThanOrEqual(2);
});

test("validates a source URL before starting", async ({ page, workerEnvironment }) => {
  await mockCredentialExchange(page, workerEnvironment.origin);
  await gotoPage(page, trialLink(workerEnvironment.origin));

  await page.getByLabel("URL").fill("not a URL");
  await page.getByLabel("URL").blur();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Load & listen" }).click();
  await expect(page.getByLabel("URL")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("button", { name: "Load & listen" })).toBeDisabled();
  await page.getByLabel("URL").fill("https://example.com");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Load & listen" })).toBeEnabled();
});

test("disables duplicate submission while a conversion start is pending", async ({
  page,
  workerEnvironment,
}) => {
  await mockCredentialExchange(page, workerEnvironment.origin);
  let finishStart: (() => void) | undefined;
  const startCanFinish = new Promise<void>((resolve) => {
    finishStart = resolve;
  });
  await page.route(
    `${workerEnvironment.origin}/api/grants/${GRANT_ID}/conversions`,
    async (route) => {
      await startCanFinish;
      await fulfillJson(route, 202, createStartResponse());
    },
  );
  await mockConversion(page, workerEnvironment.origin, createPendingConversion());
  await gotoPage(page, trialLink(workerEnvironment.origin));

  await page.getByLabel("URL").fill(SOURCE_URL);
  await page.getByRole("button", { name: "Load & listen" }).click();
  await expect(page.getByRole("button", { name: "Starting conversion..." })).toBeDisabled();
  await expect(page.getByLabel("URL")).toHaveValue(SOURCE_URL);

  finishStart?.();
  await expect(page).toHaveURL(`${workerEnvironment.origin}/app/conversions/${CONVERSION_ID}`);
  await expect(
    page.getByRole("status").filter({ hasText: "Selecting narration content..." }),
  ).toBeVisible();
});

test("shows a deterministic pending conversion", async ({ page, workerEnvironment }) => {
  await mockConversion(page, workerEnvironment.origin, createPendingConversion());
  await gotoPage(page, `${workerEnvironment.origin}/app/conversions/${CONVERSION_ID}`);

  await expect(
    page.getByRole("status").filter({ hasText: "Selecting narration content..." }),
  ).toBeVisible();
});

test("shows a deterministic failed conversion", async ({ page, workerEnvironment }) => {
  await mockConversion(page, workerEnvironment.origin, createFailedConversion());
  await gotoPage(page, `${workerEnvironment.origin}/app/conversions/${CONVERSION_ID}`);

  await expect(page.getByText("Failed!", { exact: true })).toBeVisible();
});

test("retries a conversion loading failure", async ({
  expectConsoleError,
  page,
  workerEnvironment,
}) => {
  let attempts = 0;
  await page.route(
    `${workerEnvironment.origin}/api/conversions/${CONVERSION_ID}`,
    async (route) => {
      attempts += 1;
      if (attempts === 1) {
        await fulfillError(route, 500, "operational-error", "The conversion could not be loaded.");
        return;
      }
      await fulfillJson(route, 200, createPendingConversion());
    },
  );
  expectConsoleError(CONSOLE_ERRORS.serverError);
  expectConsoleError(/^ApiError: The conversion could not be loaded\./);

  await gotoPage(page, `${workerEnvironment.origin}/app/conversions/${CONVERSION_ID}`);
  await expect(
    page.getByRole("heading", { name: "The conversion could not be opened." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Selecting narration content..." }),
  ).toBeVisible();
  expect(attempts).toBeGreaterThanOrEqual(2);
});

test("redirects a ready conversion to its audiobook", async ({ page, workerEnvironment }) => {
  await mockConversion(page, workerEnvironment.origin, createReadyConversion());
  await mockAudiobook(page, workerEnvironment.origin);

  await gotoPage(page, `${workerEnvironment.origin}/app/conversions/${CONVERSION_ID}`);
  await expect(
    page.getByRole("heading", { name: "A deterministic document about careful testing" }),
  ).toBeVisible({ timeout: 5_000 });
  await expect(
    page.getByLabel("Play A deterministic document about careful testing"),
  ).toBeVisible();
  await expect(page).toHaveURL(`${workerEnvironment.origin}/app/audiobooks/${CONVERSION_ID}`);
});

test("shows an audiobook not-found state without a retry action", async ({
  expectConsoleError,
  page,
  workerEnvironment,
}) => {
  await page.route(`${workerEnvironment.origin}/api/audiobooks/${CONVERSION_ID}`, async (route) => {
    await fulfillError(route, 404, "audiobook-not-found", "The audiobook was not found.");
  });
  expectConsoleError(CONSOLE_ERRORS.notFound);
  expectConsoleError(/^ApiError: The audiobook was not found\./);

  await gotoPage(page, `${workerEnvironment.origin}/app/audiobooks/${CONVERSION_ID}`);
  await expect(page.getByRole("heading", { name: "Audiobook not found." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
});

test("retries an audiobook loading failure", async ({
  expectConsoleError,
  page,
  workerEnvironment,
}) => {
  let attempts = 0;
  await mockAudiobookMedia(page, workerEnvironment.origin);
  await page.route(`${workerEnvironment.origin}/api/audiobooks/${CONVERSION_ID}`, async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await fulfillError(route, 500, "operational-error", "The audiobook could not be loaded.");
      return;
    }
    await fulfillJson(route, 200, createAudiobook(workerEnvironment.origin));
  });
  expectConsoleError(CONSOLE_ERRORS.serverError);
  expectConsoleError(/^ApiError: The audiobook could not be loaded\./);

  await gotoPage(page, `${workerEnvironment.origin}/app/audiobooks/${CONVERSION_ID}`);
  await expect(
    page.getByRole("heading", { name: "The audiobook could not be loaded." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { name: "A deterministic document about careful testing" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Open original source" })).toHaveAttribute(
    "href",
    SOURCE_URL,
  );
});

function createGrant(): Record<string, unknown> {
  return {
    grantId: GRANT_ID,
    createdAt: "2026-08-28T10:00:00Z",
    expiresAt: "2026-11-26T10:00:00Z",
    state: "open",
    slots: { remaining: 5, reserved: 0, spent: 0 },
  };
}

function createPendingConversion(): Record<string, unknown> {
  return {
    ...createConversionBase(),
    status: "pending",
    lastStartedPhase: "narration-content-selection",
  };
}

function createConversionBase(): Record<string, unknown> {
  return {
    conversionId: CONVERSION_ID,
    sourceUrl: SOURCE_URL,
    acceptedAt: "2026-08-28T10:05:00Z",
  };
}

function createFailedConversion(): Record<string, unknown> {
  return {
    ...createConversionBase(),
    status: "failed",
    completedAt: "2026-08-28T10:08:00Z",
    failure: { category: "narration-synthesis", explanation: "Speech synthesis failed." },
  };
}

function createReadyConversion(): Record<string, unknown> {
  return {
    ...createConversionBase(),
    title: "A deterministic document about careful testing",
    status: "ready",
    completedAt: "2026-08-28T10:08:00Z",
    audiobookUrl: `/app/audiobooks/${CONVERSION_ID}`,
  };
}

function createStartResponse(): Record<string, unknown> {
  return {
    result: "created",
    conversion: {
      ...createConversionBase(),
      status: "pending",
    },
    slots: { remaining: 4, reserved: 1, spent: 0 },
  };
}

function createAudiobook(origin: string): Record<string, unknown> {
  return {
    title: "A deterministic document about careful testing",
    originalUrl: SOURCE_URL,
    narrationDocument: {
      html: "<p>Keep the important boundaries real.</p>",
      synchronizationUnits: [
        { id: "unit-1", narrationText: "Keep the important boundaries real." },
      ],
    },
    synchronizationCues: [
      { synchronizationUnitId: "unit-1", startMilliseconds: 0, endMilliseconds: 1_000 },
    ],
    audio: {
      contentType: "audio/mpeg",
      url: `${origin}/api/audiobooks/${CONVERSION_ID}/audio.mp3`,
    },
    captions: {
      contentType: "text/vtt",
      url: `${origin}/api/audiobooks/${CONVERSION_ID}/captions.vtt`,
    },
    epub: {
      contentType: "application/epub+zip",
      url: `${origin}/api/audiobooks/${CONVERSION_ID}/book.epub`,
    },
  };
}

async function mockCredentialExchange(page: Page, origin: string): Promise<void> {
  await page.route(`${origin}/api/grants/${GRANT_ID}/sessions`, async (route) => {
    await fulfillJson(route, 201, createGrant());
  });
  await mockGrant(page, origin);
}

async function mockGrant(page: Page, origin: string): Promise<void> {
  await page.route(`${origin}/api/grants/${GRANT_ID}`, async (route) => {
    await fulfillJson(route, 200, createGrant());
  });
}

async function mockConversion(
  page: Page,
  origin: string,
  conversion: Record<string, unknown>,
): Promise<void> {
  await page.route(`${origin}/api/conversions/${CONVERSION_ID}`, async (route) => {
    await fulfillJson(route, 200, conversion);
  });
}

async function mockAudiobook(page: Page, origin: string): Promise<void> {
  await mockAudiobookMedia(page, origin);
  await page.route(`${origin}/api/audiobooks/${CONVERSION_ID}`, async (route) => {
    await fulfillJson(route, 200, createAudiobook(origin));
  });
}

async function mockAudiobookMedia(page: Page, origin: string): Promise<void> {
  await page.route(`${origin}/api/audiobooks/${CONVERSION_ID}/audio.mp3`, async (route) => {
    await route.fulfill({ status: 200, contentType: "audio/mpeg", body: "" });
  });
  await page.route(`${origin}/api/audiobooks/${CONVERSION_ID}/captions.vtt`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/vtt",
      body: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nKeep the important boundaries real.\n",
    });
  });
}

async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function fulfillError(
  route: Route,
  status: number,
  code: string,
  message: string,
): Promise<void> {
  await fulfillJson(route, status, { error: { code, message, requestId: REQUEST_ID } });
}

function trialLink(origin: string): string {
  return `${origin}/app/trials/${GRANT_ID}#credential=${CREDENTIAL}`;
}
