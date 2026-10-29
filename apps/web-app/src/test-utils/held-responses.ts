import type { Page } from "@playwright/test";

/**
 * Holds the story's responses of that name until `releaseResponses`, for example a refetch while a
 * test checks what the screen shows from the cache; see `src/ui-gallery/held-responses.ts`.
 */
export async function holdResponses(page: Page, name: string): Promise<void> {
  await callStoryFunction(page, "holdResponses", name);
}

export async function releaseResponses(page: Page, name: string): Promise<void> {
  await callStoryFunction(page, "releaseResponses", name);
}

async function callStoryFunction(page: Page, functionName: string, argument: string) {
  await page.evaluate(
    ([storyFunctionName, storyArgument]) => {
      const storyFunction: unknown = Reflect.get(window, storyFunctionName);
      if (typeof storyFunction !== "function") {
        throw new TypeError(`The story offers no ${storyFunctionName}`);
      }
      Reflect.apply(storyFunction, window, [storyArgument]);
    },
    [functionName, argument] as const,
  );
}
