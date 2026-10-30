import { Toast } from "@base-ui/react/toast";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRouteMask, createRouter, RouterProvider } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import React from "react";

import { RouteErrorScreen } from "#src/app/components/error-message.js";
import { createCoverViewTransition } from "#src/app/cover-transition.js";
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
     * A first visit keeps the previous screen, under the root layout's progress bar, until the
     * route's data arrives or its pending component is due; once shown, that stays long enough to
     * read. A loader that finds its data cached also resolves a moment later, so a revisit never
     * reaches the pending component.
     */
    defaultPendingMinMs: 300,
    defaultPendingMs: 500,
    /*
     * A link preloads its route once it scrolls into view, since touch offers no hover to preload
     * on, so opening a track from Recents is usually instant. The query cache decides whether a
     * preload requests anything, so the router keeps no preload of its own.
     */
    defaultPreload: "viewport",
    defaultPreloadStaleTime: 0,
    defaultViewTransition: createCoverViewTransition(),
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
    /**
     * Set by every in-app link on Recents, to a dialog over it or a detail view, so leaving that
     * screen goes back one entry and Recents returns at its scroll position.
     */
    isOpenedFromRecents?: boolean;
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
