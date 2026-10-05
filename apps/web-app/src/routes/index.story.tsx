import { createMemoryHistory } from "@tanstack/react-router";
import { waitFor, within } from "@testing-library/dom";
import { userEvent } from "@testing-library/user-event";
import React from "react";

import { createAppRouter, GlobalProviders } from "#src/app/global-providers.js";
import type { Story } from "#src/ui-gallery/story.js";

const router = createAppRouter(createMemoryHistory({ initialEntries: ["/app/"] }));

export function LandingPage(): React.ReactNode {
  return <GlobalProviders router={router} />;
}

export const SignIn = {
  component: LandingPage,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();
    const input = await canvas.findByRole("textbox", { name: "URL" });
    await user.clear(input);
    await user.type(input, "https://example.com/article");

    const submit = canvas.getByRole("button", { name: "Load & listen" });
    await waitFor(() => {
      if (submit.matches(":disabled")) throw new Error("Waiting for conversion submission");
    });
    await user.click(submit);
    await within(document.body).findByRole("dialog", { name: "Sign in" });
  },
} satisfies Story;
