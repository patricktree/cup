import { css } from "@linaria/core";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type React from "react";

import { DetailTopBar } from "#src/app/components/detail-top-bar.js";
import type { Story } from "#src/ui-gallery/story.js";

type DetailTopBarStoryProps = React.ComponentProps<typeof DetailTopBar>;

const MENU: DetailTopBarStoryProps["menu"] = {
  originalUrl: "https://www.example.com/article",
  retry: { isPending: false, start: () => undefined },
  deletion: { start: () => undefined },
};

export const Plain = createTopBarStory({
  back: { to: "/recent", goesBackInHistory: false },
  compactTitle: undefined,
  menu: MENU,
});

export const Compact = createTopBarStory({
  back: { to: "/recent", goesBackInHistory: false },
  compactTitle: {
    title: "A deterministic document about careful testing that runs long enough to be cut off",
    host: "source.example.test",
    isShown: true,
  },
  menu: MENU,
});

/**
 * The bar links back with the router, so it renders as the root of a router of its own. The router
 * is created on first mount, because the gallery evaluates every story module, also for other
 * stories, and a router created then takes over theirs.
 */
function createTopBarStory(props: DetailTopBarStoryProps): Story {
  let router: ReturnType<typeof createTopBarRouter> | undefined;
  return {
    component: () => <RouterProvider router={(router ??= createTopBarRouter(props))} />,
  };
}

function createTopBarRouter(props: DetailTopBarStoryProps) {
  return createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: createRootRoute({
      component: () => (
        <header
          className={css`
            padding: var(--spacing-gutter);
          `}
        >
          <DetailTopBar {...props} />
        </header>
      ),
    }),
  });
}
