import { createMemoryHistory } from "@tanstack/react-router";
import { waitFor, within } from "@testing-library/dom";
import { userEvent } from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import React from "react";

import { createAppRouter, GlobalProviders } from "#src/app/global-providers.js";
import { storePendingAccountConversion } from "#src/data-fetching/account-conversion-storage.js";
import { accountStory } from "#src/ui-gallery/account-fixtures.jsx";
import { waitWhileHeld } from "#src/ui-gallery/held-responses.js";
import type { Story } from "#src/ui-gallery/story.js";

const router = createAppRouter(createMemoryHistory({ initialEntries: ["/app/"] }));

export function LandingPage(): React.ReactNode {
  return <GlobalProviders router={router} />;
}

/** The iOS app serves the web app from `capacitor://localhost`, a scheme without a URL origin. */
const iosAppRouter = createAppRouter(createMemoryHistory({ initialEntries: ["/app/"] }), {
  pageOrigin: "capacitor://localhost",
});

export function LandingPageInIosApp(): React.ReactNode {
  return <GlobalProviders router={iosAppRouter} />;
}

export const SignIn = {
  // The landing page's route component is split into its own chunk. Loading the route before
  // mounting keeps the page from rendering empty while that chunk downloads, which can take longer
  // than the URL field lookup below waits.
  beforeMount: async () => {
    await router.load();
  },
  component: LandingPage,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();
    const input = await canvas.findByRole("textbox", { name: "URL" });
    await user.clear(input);
    await user.type(input, "https://example.com/article");

    const submit = canvas.getByRole("button", { name: "Listen" });
    await waitFor(() => {
      if (submit.matches(":disabled")) {
        throw new Error("Waiting for conversion submission");
      }
    });
    await user.click(submit);
    await within(document.body).findByRole("dialog", { name: "Sign in" });
  },
} satisfies Story;

/** Local development without a Google client: the configuration offers only the test account. */
export const SignInWithTestAccount = {
  ...SignIn,
  handlers: [
    http.get("/api/auth/config", () =>
      HttpResponse.json({
        supabaseUrl: `${window.location.origin}/__story`,
        publishableKey: "story-key",
        testAccount: { email: "test@cup.test", password: "story-password" },
      }),
    ),
  ],
} satisfies Story;

/** A signed-out listener opens the sign-in dialog from the line under the form. */
export const SignInFromLink = {
  beforeMount: SignIn.beforeMount,
  component: LandingPage,
  play: async ({ canvasElement }) => {
    const user = userEvent.setup();
    await user.click(await within(canvasElement).findByRole("link", { name: "Sign in" }));
    await within(document.body).findByRole("dialog", { name: "Sign in" });
  },
} satisfies Story;

export const SignInFromLinkWithTestAccount = {
  ...SignInFromLink,
  handlers: SignInWithTestAccount.handlers,
} satisfies Story;

/**
 * Account auth fails to initialize, so home shows signed out, and a sign-in that initializes it
 * again fails too. Holding `"auth-config"` keeps that retry loading.
 */
export const HomeWhileAuthUnavailable = {
  beforeMount: SignIn.beforeMount,
  component: LandingPage,
  handlers: [
    http.get("/api/auth/config", async () => {
      await waitWhileHeld("auth-config");
      return HttpResponse.json(
        { error: { message: "Sign-in is temporarily unavailable." } },
        { status: 503 },
      );
    }),
  ],
} satisfies Story;

/**
 * A start submitted from the home page resumed after sign-in and is still pending, so a signed-in
 * listener stays on home instead of being redirected to Recents.
 */
export const SignedInHomeWithPendingStart = {
  ...accountStory({
    path: "/",
    handlers: [http.post("/api/account/conversions", () => delay("infinite"))],
  }),
  beforeMount: async () => {
    storePendingAccountConversion({
      sourceUrl: "https://example.com/article",
      idempotencyKey: "0f8fad5b-d9cb-469f-a165-70867728950e",
      submitted: true,
    });
  },
} satisfies Story;
