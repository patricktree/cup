import type { Page } from "@playwright/test";
import { z } from "zod";

const LOADING_STATE_MARKERS = ["data-loading-state", "data-pending-signal"] as const;

const loadingStateRecordSchema = z.array(
  z.object({
    marker: z.enum(LOADING_STATE_MARKERS),
    /** `aria-label`, else the trimmed text, so a failure names the loading state it saw. */
    name: z.string(),
    /** `performance.now()` when the observer saw it; it follows an installed Playwright clock. */
    at: z.number(),
  }),
);

/** A marked element the page inserted. */
export type LoadingStateRecord = z.infer<typeof loadingStateRecordSchema>[number];

/** Where the page keeps the record, for `readLoadingStateRecord`. */
const RECORD_KEY = "cupLoadingStateRecord";

/**
 * Records every element marked as a loading state (`data-loading-state`) or as the navigation's
 * progress bar (`data-pending-signal`) that the page shows, however briefly: the observer sees an
 * element inserted and removed within one task, and marked descendants of an added subtree.
 *
 * Call it before the page navigates or mounts a story; the record starts empty on each document.
 */
export async function recordLoadingStates(page: Page): Promise<void> {
  await page.addInitScript(
    ({ recordKey, markers }) => {
      const record: LoadingStateRecord[] = [];
      Object.assign(window, { [recordKey]: record });

      const selector = markers.map((marker) => `[${marker}]`).join(", ");
      new MutationObserver((mutations) => {
        /*
         * An element and its ancestors added in one task each show up as added nodes, and by the
         * time the observer runs every ancestor's subtree contains it, so one batch counts each
         * element once.
         */
        const insertedElements = new Set<Element>();
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (!(node instanceof Element)) {
              continue;
            }
            if (node.matches(selector)) {
              insertedElements.add(node);
            }
            for (const descendant of node.querySelectorAll(selector)) {
              insertedElements.add(descendant);
            }
          }
        }

        const now = performance.now();
        for (const element of insertedElements) {
          const marker = markers.find((candidate) => element.hasAttribute(candidate));
          if (marker === undefined) {
            throw new Error("An element matched the marker selector without carrying a marker.");
          }
          record.push({
            marker,
            name: element.getAttribute("aria-label") ?? element.textContent.trim(),
            at: now,
          });
        }
      }).observe(document, { childList: true, subtree: true });
    },
    { recordKey: RECORD_KEY, markers: LOADING_STATE_MARKERS },
  );
}

/** Every loading state recorded so far, in the order the page inserted them. */
export async function readLoadingStateRecord(page: Page): Promise<LoadingStateRecord[]> {
  const record = await page.evaluate(
    (recordKey): unknown => Reflect.get(window, recordKey),
    RECORD_KEY,
  );
  if (record === undefined) {
    throw new Error("No loading state record: call recordLoadingStates before the page loads.");
  }
  return loadingStateRecordSchema.parse(record);
}
