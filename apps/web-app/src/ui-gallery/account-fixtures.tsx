import { createMemoryHistory } from "@tanstack/react-router";
import { http, HttpResponse } from "msw";
import React from "react";

import { createAppRouter, GlobalProviders } from "#src/app/global-providers.js";
import { ACCOUNT_CONFIRMATION_STORAGE_KEY } from "#src/data-fetching/account-confirmation-storage.js";
import { ACCOUNT_SESSION_STORAGE_KEY } from "#src/data-fetching/account-session-storage.js";
import { ensureAuthInitialized } from "#src/data-fetching/account-session.js";
import type { Story } from "#src/ui-gallery/story.js";

const SUBJECT = "880ce5b5-6542-40fd-8f2d-380f3066e98a";
const ACCOUNT_ID = "70fcf2d9-63c5-48be-b897-d3670f24ed43";
export const CONVERSION_ID = "693af4c4-9fa8-430d-9dc5-c00e88fb38a7";
const CHALLENGE_ID = "a3fcb5d8-9162-4c1a-b804-3be130c5e92a";
const router = createAppRouter(createMemoryHistory({ initialEntries: ["/app/"] }));

/** Exercise the real session adapter against local deterministic identity and API responses. */
export function accountStory({
  path,
  state = "active",
  history = { items: [], nextCursor: null },
  confirmation,
  setupFailure = false,
}: {
  path: string;
  state?: "active" | "deletion_scheduled" | "deleting";
  history?: { items: Record<string, unknown>[]; nextCursor: string | null };
  confirmation?: "delete" | "restore";
  setupFailure?: boolean | "once";
}): Story {
  let setupFailed = false;
  function AccountStory(): React.ReactNode {
    const [ready, setReady] = React.useState(false);
    const [error, setError] = React.useState<string>();
    React.useEffect(() => {
      const initialize = async () => {
        await initializeAccountStorySession(confirmation);
        await router.navigate({ href: `/app${path}` });
        setReady(true);
      };
      void initialize().catch((failure: unknown) => setError(String(failure)));
    }, []);
    return error ? (
      <p role="alert">{error}</p>
    ) : ready ? (
      <GlobalProviders router={router} />
    ) : (
      <output>Loading account story…</output>
    );
  }
  return {
    component: AccountStory,
    handlers: [
      http.get("/api/auth/config", () =>
        HttpResponse.json({
          supabaseUrl: window.location.origin + "/__story",
          publishableKey: "story-key",
          googleWebClientId: "story-client",
        }),
      ),
      http.post("/api/files/session", () => new HttpResponse(null, { status: 204 })),
      http.get("/api/account", () => {
        if (setupFailure && (setupFailure !== "once" || !setupFailed)) {
          setupFailed = true;
          return HttpResponse.json(
            { error: { message: "Account setup unavailable." } },
            { status: 503 },
          );
        }
        return HttpResponse.json({
          accountId: ACCOUNT_ID,
          createdAtMs: 0,
          subject: SUBJECT,
          state,
          executionEpoch: 1,
          recoveryDeadlineMs: state === "active" ? null : 1893456000000,
          balance: { unit: "audio-millisecond", available: 1_800_000, reserved: 0 },
        });
      }),
      http.get("/api/account/conversions", ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.has("cursor")
            ? {
                items: [
                  {
                    conversionId: SUBJECT,
                    idempotencyKey: SUBJECT,
                    sourceUrl: "https://example.test/another",
                    createdAtMs: 0,
                    status: "ready",
                    outcome: { status: "ready", title: "Another private audiobook" },
                  },
                ],
                nextCursor: null,
              }
            : history,
        ),
      ),
      http.get(`/api/conversions/${CONVERSION_ID}`, () =>
        HttpResponse.json({
          conversionId: CONVERSION_ID,
          sourceUrl: "https://example.test/article",
          acceptedAt: "2026-09-30T10:00:00Z",
          status: "pending",
          lastStartedPhase: "audio-segment-production",
        }),
      ),
    ],
  };
}

async function initializeAccountStorySession(confirmation?: "delete" | "restore") {
  const payload = btoa(JSON.stringify({ sub: SUBJECT, exp: 4102444800 })).replaceAll("=", "");
  localStorage.setItem(
    ACCOUNT_SESSION_STORAGE_KEY,
    JSON.stringify({
      access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.fixture`,
      refresh_token: "story-refresh",
      token_type: "bearer",
      expires_at: 4102444800,
      expires_in: 300,
      user: { id: SUBJECT, email: "reader@example.test" },
    }),
  );
  if (confirmation)
    sessionStorage.setItem(
      ACCOUNT_CONFIRMATION_STORAGE_KEY,
      JSON.stringify({
        challengeId: CHALLENGE_ID,
        subject: SUBJECT,
        issuedAtMs: 0,
        expiresAtMs: 4102444800000,
        action: confirmation,
      }),
    );
  await ensureAuthInitialized();
}
