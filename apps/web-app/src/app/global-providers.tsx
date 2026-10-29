import { Toast } from "@base-ui/react/toast";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRouteMask, createRouter, RouterProvider } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import React from "react";

import { RouteErrorScreen } from "#src/app/components/error-message.js";
import { DSToastViewport } from "#src/app/design-system/toast.js";
import { queryClient } from "#src/data-fetching/query-client.js";
import { toastManager } from "#src/notifications.js";
import { routeTree } from "#src/routeTree.gen.js";

/**
 * The Add dialog route keeps the URL bar on Recents. A reload still opens the dialog, because the
 * mask keeps `unmaskOnReload` false.
 */
const addDialogMask = createRouteMask({ routeTree, from: "/recent/add", to: "/recent" });

export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    basepath: "/app",
    ...(history && { history }),
    context: {
      queryClient,
    },
    defaultErrorComponent: RouteErrorScreen,
    /*
     * A loader that finds its data cached still resolves a moment later, so the previous screen
     * stays until the route's pending component is due; once shown, it stays long enough to read.
     */
    defaultPendingMinMs: 300,
    defaultPendingMs: 500,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    routeTree,
    routeMasks: [addDialogMask],
    // The document is the scroll container, which the router restores and resets by default.
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  // oxlint-disable typescript/consistent-type-definitions -- TanStack Router requires interface merging to register the router's inferred type.
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
  interface HistoryState {
    /** Set when the app itself opened a dialog over Recents, so closing it goes back one entry. */
    isRecentsDialogOpenedInApp?: boolean;
  }
  // oxlint-enable typescript/consistent-type-definitions
}

/** Installs the application-wide query client, router, and toast providers. */
export function GlobalProviders({
  router,
}: {
  router: ReturnType<typeof createAppRouter>;
}): React.ReactNode {
  return (
    <QueryClientProvider client={queryClient}>
      <Toast.Provider toastManager={toastManager}>
        <RouterProvider router={router} />
        <DSToastViewport />
      </Toast.Provider>
    </QueryClientProvider>
  );
}
