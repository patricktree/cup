import { createFileRoute } from "@tanstack/react-router";
import React from "react";

import { AddAudiobookDialog } from "#src/app/components/add-audiobook-dialog.js";
import { useCloseRecentsDialog } from "#src/app/use-close-recents-dialog.js";

/** The Add dialog over Recents; a route mask in `createAppRouter` keeps the URL bar on `/recent`. */
export const Route = createFileRoute("/_shell/recent/add")({
  component: AddAudiobookPage,
});

function AddAudiobookPage(): React.ReactNode {
  const close = useCloseRecentsDialog(Route.id);

  return <AddAudiobookDialog onClose={close} />;
}
