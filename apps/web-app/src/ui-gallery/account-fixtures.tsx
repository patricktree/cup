import { createMemoryHistory } from "@tanstack/react-router";
import { http, HttpResponse, type RequestHandler } from "msw";
import React from "react";

import { createAppRouter, GlobalProviders } from "#src/app/global-providers.js";
import { ACCOUNT_SESSION_STORAGE_KEY } from "#src/auth/account-session-storage.js";
import { ensureAuthInitialized } from "#src/auth/account-session.js";
import { ACCOUNT_CONFIRMATION_STORAGE_KEY } from "#src/data-fetching/account-confirmation-storage.js";
import type { Story } from "#src/ui-gallery/story.js";

const SUBJECT = "880ce5b5-6542-40fd-8f2d-380f3066e98a";
const ACCOUNT_ID = "70fcf2d9-63c5-48be-b897-d3670f24ed43";
const CHALLENGE_ID = "a3fcb5d8-9162-4c1a-b804-3be130c5e92a";

/** Exercise the real session adapter against local deterministic identity and API responses. */
export function accountStory({
  path,
  state = "active",
  recents = { items: [], nextCursor: null },
  confirmation,
  setupFailure = false,
  userMetadata = { name: "Verena Handler-Kunze" },
  isSignedOut = false,
  isColdStart = false,
  handlers = [],
  play,
}: {
  path: string;
  state?: "active" | "deletion_scheduled" | "deleting";
  recents?: { items: Record<string, unknown>[]; nextCursor: string | null };
  confirmation?: "delete" | "restore";
  setupFailure?: boolean | "once";
  /** The session user's metadata, which carries the name the avatar shows. */
  userMetadata?: Record<string, unknown>;
  /** Starts without a stored session, as a listener following a link does. */
  isSignedOut?: boolean;
  /** Mounts the app while auth restores the stored session, as a cold start does. */
  isColdStart?: boolean;
  handlers?: RequestHandler[];
  play?: Story["play"];
}): Story {
  let setupFailed = false;
  function AccountStory(): React.ReactNode {
    /*
     * Each mount gets its own router that starts at the story's path. Navigating a router that an
     * earlier story mounted would let that story's still mounted tree react to the navigation, and
     * once that tree unmounts, the navigation waits for a render that only follows it.
     */
    const [router] = React.useState(() =>
      createAppRouter(createMemoryHistory({ initialEntries: [`/app${path}`] })),
    );
    const [ready, setReady] = React.useState(false);
    const [error, setError] = React.useState<string>();
    React.useEffect(() => {
      Object.assign(window, {
        // Lets tests go back as the system Back gesture does, which no element of the page sees.
        goBackInAccountStory: () => router.history.back(),
        // Lets tests open a screen that no element of the current one links to, as a typed URL does.
        openPathInAccountStory: (pathToOpen: string) => router.history.push(`/app${pathToOpen}`),
        // Lets tests tell a replaced history entry from a pushed one.
        readAccountStoryHistoryLength: () => router.history.length,
      });
      const initialize = async () => {
        // A signed-out story stores no session, so neither its user nor a confirmation applies.
        if (!isSignedOut) {
          storeAccountStorySession(userMetadata, confirmation);
        }
        if (isColdStart) {
          // Loads every route's code first, so the screen renders as soon as its route lets it.
          for (const route of Object.values(router.routesById)) {
            await router.loadRouteChunk(route);
          }
          setReady(true);
        }
        await ensureAuthInitialized();
        setReady(true);
      };
      void initialize().catch((failure: unknown) => setError(String(failure)));
    }, [router]);
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
    ...(play && { play }),
    handlers: [
      ...handlers,
      http.get("/api/auth/config", () =>
        HttpResponse.json({
          supabaseUrl: window.location.origin + "/__story",
          publishableKey: "story-key",
          googleWebClientId: "story-client",
        }),
      ),
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
            : recents,
        ),
      ),
    ],
  };
}

function storeAccountStorySession(
  userMetadata: Record<string, unknown>,
  confirmation?: "delete" | "restore",
) {
  const payload = btoa(JSON.stringify({ sub: SUBJECT, exp: 4102444800 })).replaceAll("=", "");
  localStorage.setItem(
    ACCOUNT_SESSION_STORAGE_KEY,
    JSON.stringify({
      access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.fixture`,
      refresh_token: "story-refresh",
      token_type: "bearer",
      expires_at: 4102444800,
      expires_in: 300,
      user: { id: SUBJECT, email: "reader@example.test", user_metadata: userMetadata },
    }),
  );
  if (confirmation) {
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
  }
}
