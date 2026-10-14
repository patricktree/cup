import { Toast } from "@base-ui/react/toast";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import React from "react";

import { RouteErrorScreen } from "#src/app/components/error-message.js";
import { DSToastViewport } from "#src/app/design-system/toast.js";
import { queryClient } from "#src/data-fetching/query-client.js";
import { toastManager } from "#src/notifications.js";
import { routeTree } from "#src/routeTree.gen.js";

export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    basepath: "/app",
    ...(history && { history }),
    context: {
      queryClient,
    },
    defaultErrorComponent: RouteErrorScreen,
    defaultPendingMinMs: 0,
    defaultPendingMs: 0,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    routeTree,
    scrollRestoration: true,
    // The document itself never scrolls; `<main>` in the root route is the scroll container that must reset on navigation.
    scrollToTopSelectors: ["main"],
  });
}

declare module "@tanstack/react-router" {
  // oxlint-disable typescript/consistent-type-definitions -- TanStack Router requires interface merging to register the router's inferred type.
  interface Register {
    router: ReturnType<typeof createAppRouter>;
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
