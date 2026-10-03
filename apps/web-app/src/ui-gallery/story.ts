import type { RequestHandler } from "msw";
import type React from "react";

export type StoryComponent = (props: Record<string, unknown>) => React.ReactNode;

export type Story = {
  component: StoryComponent;
  handlers?: RequestHandler[];
};
