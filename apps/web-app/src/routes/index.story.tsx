import { createMemoryHistory } from "@tanstack/react-router";
import { waitFor, within } from "@testing-library/dom";
import { userEvent } from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import React from "react";

import { createAppRouter, GlobalProviders } from "#src/app/global-providers.js";
import type { Story } from "#src/ui-gallery/story.js";

const router = createAppRouter(createMemoryHistory({ initialEntries: ["/app/"] }));

export function LandingPage(): React.ReactNode {
  return <GlobalProviders router={router} />;
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

    const submit = canvas.getByRole("button", { name: "Load & listen" });
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
