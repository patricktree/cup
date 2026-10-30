import type { Page } from "@playwright/test";

/**
 * Records React's development warning that a component called `use()` to suspend and did not call
 * it when it finished, for example a code-split route component rendered before its chunk loaded.
 *
 * Call it before the page mounts a story. React issues the warning once per document.
 */
export function recordReactUseWarnings(page: Page): string[] {
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("https://react.dev/warnings/conditional-use-of-use")) {
      warnings.push(message.text());
    }
  });

  return warnings;
}
