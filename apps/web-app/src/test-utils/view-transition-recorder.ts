import type { Page } from "@playwright/test";
import { z } from "zod";

/** The view transition name of a track's moving cover (`src/app/cover-transition.ts`). */
const COVER_TRANSITION_NAME = "track-cover";

/** The view transition name that both screens' bottom bars share. */
const BOTTOM_BAR_NAME = "bottom-bar";

/** The view transition names of the screens' content, sorted. */
const SCREEN_NAMES = ["detail-header", "detail-screen", "recents-screen"];

const coverPlaceSchema = z.enum(["card", "detail"]);

const viewTransitionRecordSchema = z.array(
  z.object({
    types: z.array(z.string()).optional(),
    /** Where each element named as the moving cover sits when the old screen is captured. */
    oldCovers: z.array(coverPlaceSchema),
    /** The same, when the new screen is captured. */
    newCovers: z.array(coverPlaceSchema),
    /**
     * The distance from the shown bottom bar to the bottom of the screen, once the new screen
     * shows.
     */
    bottomBarGap: z.number().optional(),
    /** Whether the bottom bars are drawn above the moving cover. */
    isBottomBarAboveCover: z.boolean(),
    /** Whether the two screens' bottom bars cross-fade as one pair, so no text shows through. */
    isBottomBarPair: z.boolean(),
    /** The screens' content fading in or out, each in a snapshot of its own. */
    fadingScreens: z.array(z.string()),
    /** Whether the document has a snapshot of its own, which would draw stuck bars too low. */
    isDocumentCaptured: z.boolean(),
  }),
);

/** A view transition that the page started and that got ready to run. */
export type ViewTransitionRecord = z.infer<typeof viewTransitionRecordSchema>[number];

/** Where the page keeps the record, for `readViewTransitionRecord`. */
const RECORD_KEY = "cupViewTransitionRecord";

/**
 * Records every same-document view transition the page starts, with the covers it moves: a cover
 * inside a list item is a Recents card's, any other the detail view's. A transition the browser
 * skips, such as one with a duplicate name, never gets ready and is not recorded.
 *
 * Call it before the page navigates or mounts a story; the record starts empty on each document.
 */
export async function recordViewTransitions(page: Page): Promise<void> {
  await page.addInitScript(
    ({ recordKey, coverTransitionName, bottomBarName, screenNames }) => {
      const record: unknown[] = [];
      Object.assign(window, { [recordKey]: record });

      const findCovers = () =>
        [...document.querySelectorAll("[data-track-cover]")]
          .filter((element) => getComputedStyle(element).viewTransitionName === coverTransitionName)
          .map((element) => (element.closest("li") ? "card" : "detail"));

      const isBottomBarAboveCover = () =>
        getComputedStyle(document.documentElement, `::view-transition-group(${bottomBarName})`)
          .zIndex === "2";

      const hasBottomBarPair = (pseudoElements: (string | null)[]) =>
        pseudoElements.includes(`::view-transition-old(${bottomBarName})`) &&
        pseudoElements.includes(`::view-transition-new(${bottomBarName})`);

      const startViewTransition = document.startViewTransition.bind(document);
      document.startViewTransition = (options) => {
        const transition = startViewTransition(options);
        // The rule that names a cover matches only from here on; the old screen is still shown.
        const oldCovers = findCovers();
        void (async () => {
          try {
            await transition.ready;
          } catch {
            // skipped by the browser
            return;
          }
          const bottomBar =
            document.querySelector('footer[aria-label="Player"]') ??
            document.querySelector('section[aria-label="Player"]')?.parentElement;
          const pseudoElements = document
            .getAnimations()
            .map(({ effect }) => (effect instanceof KeyframeEffect ? effect.pseudoElement : null));
          record.push({
            ...(typeof options === "object" && { types: options.types }),
            oldCovers,
            newCovers: findCovers(),
            isBottomBarAboveCover: isBottomBarAboveCover(),
            isBottomBarPair: hasBottomBarPair(pseudoElements),
            fadingScreens: screenNames.filter((name) =>
              pseudoElements.some((element) => element?.endsWith(`(${name})`)),
            ),
            isDocumentCaptured: pseudoElements.some((element) => element?.endsWith("(root)")),
            bottomBarGap:
              bottomBar && Math.round(innerHeight - bottomBar.getBoundingClientRect().bottom),
          });
        })();
        return transition;
      };
    },
    {
      recordKey: RECORD_KEY,
      coverTransitionName: COVER_TRANSITION_NAME,
      bottomBarName: BOTTOM_BAR_NAME,
      screenNames: SCREEN_NAMES,
    },
  );
}

/** Every view transition recorded so far, in the order they got ready. */
export async function readViewTransitionRecord(page: Page): Promise<ViewTransitionRecord[]> {
  const record = await page.evaluate(
    (recordKey): unknown => Reflect.get(window, recordKey),
    RECORD_KEY,
  );
  if (record === undefined) {
    throw new Error("No view transition record: call recordViewTransitions before the page loads.");
  }
  return viewTransitionRecordSchema.parse(record);
}
