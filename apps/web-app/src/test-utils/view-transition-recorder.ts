import type { Page } from "@playwright/test";
import { z } from "zod";

/** The view transition name of a track's moving cover (`src/app/cover-transition.ts`). */
const COVER_TRANSITION_NAME = "track-cover";

const coverPlaceSchema = z.enum(["card", "detail"]);

const viewTransitionRecordSchema = z.array(
  z.object({
    types: z.array(z.string()).optional(),
    /** Where each element named as the moving cover sits when the old screen is captured. */
    oldCovers: z.array(coverPlaceSchema),
    /** The same, when the new screen is captured. */
    newCovers: z.array(coverPlaceSchema),
    /** The moving cover's computed `border-radius` when the transition starts and ends. */
    coverCorners: z.object({ start: z.string(), end: z.string() }).optional(),
    /**
     * The distance from the shown bottom bar to the bottom of the screen, once the new screen
     * shows.
     */
    bottomBarGap: z.number().optional(),
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
    ({ recordKey, coverTransitionName }) => {
      const record: unknown[] = [];
      Object.assign(window, { [recordKey]: record });

      const findCovers = () =>
        [...document.querySelectorAll<HTMLElement>("*")]
          .filter((element) => element.style.viewTransitionName === coverTransitionName)
          .map((element) => (element.closest("li") ? "card" : "detail"));

      const readCoverCorners = () => {
        const pseudoElement = `::view-transition-image-pair(${coverTransitionName})`;
        const animation = document.getAnimations().find((candidate) => {
          const { effect } = candidate;
          return effect instanceof KeyframeEffect && effect.pseudoElement === pseudoElement;
        });
        if (animation === undefined) {
          return undefined;
        }
        const readAt = (time: number) => {
          animation.currentTime = time;
          return getComputedStyle(document.documentElement, pseudoElement).borderRadius;
        };
        animation.pause();
        const corners = {
          start: readAt(0),
          end: readAt(Number(animation.effect?.getComputedTiming().endTime)),
        };
        animation.currentTime = 0;
        animation.play();
        return corners;
      };

      const startViewTransition = document.startViewTransition.bind(document);
      document.startViewTransition = (options) => {
        const oldCovers = findCovers();
        const transition = startViewTransition(options);
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
          record.push({
            ...(typeof options === "object" && { types: options.types }),
            oldCovers,
            newCovers: findCovers(),
            coverCorners: readCoverCorners(),
            bottomBarGap:
              bottomBar && Math.round(innerHeight - bottomBar.getBoundingClientRect().bottom),
          });
        })();
        return transition;
      };
    },
    { recordKey: RECORD_KEY, coverTransitionName: COVER_TRANSITION_NAME },
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
