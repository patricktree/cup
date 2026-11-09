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

export function createAppRouter(
  history?: RouterHistory,
  { pageOrigin = window.origin }: { pageOrigin?: string } = {},
) {
  const router = createRouter({
    basepath: "/app",
    ...(history && { history }),
    origin: routerOrigin(pageOrigin),
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
    routeTree,
    routeMasks: [addDialogMask],
    // The document is the scroll container, which the router restores and resets by default.
    scrollRestoration: true,
  });
  // The cover transition looks up routes on the router it belongs to.
  router.update({ ...router.options, defaultViewTransition: createCoverViewTransition(router) });
  return router;
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
    /** Set by the mini player's link, so its detail view only cross-fades, both ways. */
    isOpenedFromMiniPlayer?: boolean;
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

/**
 * The iOS app serves the web app from `capacitor://localhost`. The router resolves every path
 * against its origin and treats a URL as external unless it is HTTP(S) with that same origin; a
 * `capacitor:` URL is neither, and its origin parses as "null". So every in-app location would
 * count as external, and the router, which blocks document navigation to schemes outside its
 * allowlist, would drop the first navigation silently and render no route. Any HTTP(S) origin keeps
 * in-app paths internal; the router uses it only to parse and compare paths.
 */
function routerOrigin(pageOrigin: string): string {
  // A sandboxed document reports the origin "null", which is no URL to parse.
  const isHttpOrigin = pageOrigin.startsWith("http://") || pageOrigin.startsWith("https://");
  return isHttpOrigin ? pageOrigin : "http://localhost";
}
