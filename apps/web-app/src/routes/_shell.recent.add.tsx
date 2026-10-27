import { createFileRoute, useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import React from "react";

import { AddAudiobookDialog } from "#src/app/components/add-audiobook-dialog.js";

/** The Add dialog over Recents; a route mask in `createAppRouter` keeps the URL bar on `/recent`. */
export const Route = createFileRoute("/_shell/recent/add")({
  component: AddAudiobookPage,
});

function AddAudiobookPage(): React.ReactNode {
  const router = useRouter();
  const navigate = useNavigate();
  const isOpenedInApp = useLocation({
    select: (location) => location.state.isAddDialogOpenedInApp === true,
  });
  // Closing and a successful start can both ask to leave, but only one may move the history.
  const isClosing = React.useRef(false);

  const close = () => {
    if (isClosing.current) {
      return;
    }
    isClosing.current = true;

    // Opening inside the app pushed this entry, so Back returns to Recents; a share or a direct
    // link has no Recents entry below it to return to.
    if (isOpenedInApp) {
      router.history.back();
    } else {
      void navigate({ to: "/recent", replace: true });
    }
  };

  return <AddAudiobookDialog onClose={close} />;
}
