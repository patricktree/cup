import { queryClient } from "#src/data-fetching/query-client.js";
import type { Story } from "#src/ui-gallery/story.js";

/**
 * Runs a story with a query cache that keeps data for the page lifetime, so a test sees what the
 * cache shows when the listener returns to a screen.
 */
export function withPageLifetimeCache(story: Story): Story {
  return {
    ...story,
    beforeMount: async () => {
      queryClient.setDefaultOptions({
        ...queryClient.getDefaultOptions(),
        queries: { ...queryClient.getDefaultOptions().queries, gcTime: Infinity },
      });
      await story.beforeMount?.();
    },
  };
}
