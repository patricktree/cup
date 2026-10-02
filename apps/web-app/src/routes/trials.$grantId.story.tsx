import { createMemoryHistory } from "@tanstack/react-router";
import type { ResolveParams } from "@tanstack/react-router";
import { delay, http, HttpResponse } from "msw";
import React from "react";

import type { Story } from "#ui-gallery/story.js";

import type { ErrorResponse, GrantSnapshot } from "@cup/web-app-api.routes";

import { createAppRouter, GlobalProviders } from "#src/app/global-providers.js";
import { Route as trialRoute } from "#src/routes/trials.$grantId.js";

const GRANT_ID = "b4ad28a8-bbd7-46af-a17c-59527becd745";
const memoryHistory = createMemoryHistory({ initialEntries: ["/app/"] });
// TanStack initializes route objects in place, so this story module must create one router only.
const router = createAppRouter(memoryHistory);

export const OpenGrant = {
  component: () => <TrialRoute />,
  handlers: [
    // Native share tests use the production API origin; keep auth initialization local too.
    http.get("*/api/auth/config", () =>
      HttpResponse.json(
        {
          error: {
            code: "auth-unavailable",
            message: "Sign-in is unavailable in this trial story.",
            requestId: "trial-story",
          },
        } satisfies ErrorResponse,
        { status: 503 },
      ),
    ),
    http.get(`*/api/grants/${GRANT_ID}`, () =>
      HttpResponse.json({
        grantId: GRANT_ID,
        createdAt: "2026-08-28T10:00:00Z",
        expiresAt: "2026-11-26T10:00:00Z",
        state: "open",
        duration: {
          availableMilliseconds: 7_200_000,
          reservedMilliseconds: 0,
          spentMilliseconds: 0,
        },
      } satisfies GrantSnapshot),
    ),
  ],
} satisfies Story;

export function MalformedCredential(): React.ReactNode {
  return <TrialRoute hash="credential=malformed" />;
}

export const RevokedCredential = {
  component: () => <TrialRoute hash={`credential=v1.${"a".repeat(43)}`} />,
  handlers: [
    http.post(`/api/grants/${GRANT_ID}/sessions`, () =>
      HttpResponse.json(
        {
          error: {
            requestId: "09e6d824-d41d-43bb-9417-18f89232ba56",
            code: "grant-revoked",
            message: "The grant was revoked.",
          },
        } satisfies ErrorResponse,
        { status: 403 },
      ),
    ),
  ],
} satisfies Story;

export const CredentialExchangeError = {
  component: () => <TrialRoute hash={`credential=v1.${"a".repeat(43)}`} />,
  handlers: [
    http.post(`/api/grants/${GRANT_ID}/sessions`, () =>
      HttpResponse.json(
        {
          error: {
            requestId: "09e6d824-d41d-43bb-9417-18f89232ba56",
            code: "dependency-unavailable",
            message: "The service is unavailable.",
          },
        } satisfies ErrorResponse,
        { status: 503 },
      ),
    ),
  ],
} satisfies Story;

export const GrantLoadError = {
  component: () => <TrialRoute />,
  handlers: [
    http.get(`*/api/grants/${GRANT_ID}`, () =>
      HttpResponse.json(
        {
          error: {
            requestId: "09e6d824-d41d-43bb-9417-18f89232ba56",
            code: "operational-error",
            message: "The Trial could not be loaded.",
          },
        } satisfies ErrorResponse,
        { status: 500 },
      ),
    ),
  ],
} satisfies Story;

export const StartPending = {
  component: () => <TrialRoute />,
  handlers: [
    ...OpenGrant.handlers,
    http.post(`/api/grants/${GRANT_ID}/conversions`, async () => {
      await delay("infinite");
    }),
  ],
} satisfies Story;

function TrialRoute({ hash = "" }: { hash?: string }) {
  const location = router.buildLocation({
    to: trialRoute.fullPath,
    params: { grantId: GRANT_ID } satisfies ResolveParams<typeof trialRoute.fullPath>,
    hash,
  });
  memoryHistory.replace(location.href);

  return <GlobalProviders router={router} />;
}

export const StartUnavailable = {
  component: () => <TrialRoute />,
  handlers: [
    ...OpenGrant.handlers,
    http.post(`/api/grants/${GRANT_ID}/conversions`, () =>
      HttpResponse.json(
        {
          error: {
            requestId: "09e6d824-d41d-43bb-9417-18f89232ba56",
            code: "dependency-unavailable",
            message: "The service is unavailable.",
          },
        } satisfies ErrorResponse,
        { status: 503 },
      ),
    ),
  ],
} satisfies Story;
