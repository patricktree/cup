import { useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import React from "react";

import type { FileRouteTypes } from "#src/routeTree.gen.js";

/**
 * Closes a dialog route over Recents (`/recent/add`, `/recent/account`), returning to Recents. The
 * returned function does nothing once the dialog has closed or the router has left it.
 */
export function useCloseRecentsDialog(routeId: FileRouteTypes["id"]): () => void {
  const router = useRouter();
  const navigate = useNavigate();
  const isOpenedInApp = useLocation({
    select: (location) => location.state.isOpenedFromRecents === true,
  });
  // Several events can ask to close, such as the Add dialog's Cancel and its successful start, but
  // only one may move the history.
  const isClosing = React.useRef(false);

  return () => {
    // The system Back gesture leaves without closing, and the Add dialog's start can still succeed
    // afterwards.
    const isDialogShown = router.state.matches.some((match) => match.routeId === routeId);
    if (isClosing.current || !isDialogShown) {
      return;
    }
    isClosing.current = true;

    // Opening inside the app pushed this entry, so Back returns to Recents; a share, a direct link
    // or the return from a Google sign-in has no Recents entry below it to return to.
    if (isOpenedInApp) {
      router.history.back();
    } else {
      void navigate({ to: "/recent", replace: true });
    }
  };
}
