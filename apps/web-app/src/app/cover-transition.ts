import type { ParsedLocation } from "@tanstack/react-router";

import { TRACK_COVER_TRANSITION_NAME } from "#src/app/view-transition-names.js";

/**
 * Opening a track from Recents, and going back from its detail view to Recents, moves the track's
 * cover from where it was to where it lands, in a View Transition that the router starts for the
 * navigation. One rule names that track's covers, and only while a cover transition runs: a second
 * element with the same name would make the browser skip the whole transition.
 */
const COVER_TRANSITION_TYPE = "track-cover";
const SCREEN_FADE_TYPE = "screen-fade";

const RECENTS_PATH = /\/recent\/?$/;
const DETAIL_PATH = /\/audiobooks\/([^/]+)\/?$/;

let coverNameRule: CSSStyleSheet | undefined;
let isPopStateVisualTransition = false;

/**
 * The router's view transition setting: a transition for Recents to a detail view and back, none
 * for any other navigation. Browsers without view transition types get no transition at all, as the
 * router would otherwise cross-fade every navigation.
 */
export function createCoverViewTransition():
  | false
  | {
      types: (change: {
        fromLocation?: ParsedLocation;
        toLocation: ParsedLocation;
      }) => string[] | false;
    } {
  if (!supportsViewTransitionTypes()) {
    return false;
  }

  if (coverNameRule === undefined) {
    coverNameRule = new CSSStyleSheet();
    document.adoptedStyleSheets.push(coverNameRule);

    // A swipe-back on iOS Safari already animates the page; a second animation would replay it.
    window.addEventListener(
      "popstate",
      (event) => {
        isPopStateVisualTransition = event.hasUAVisualTransition;
      },
      { capture: true },
    );
  }
  const rule = coverNameRule;

  return {
    types: ({ fromLocation, toLocation }) => {
      const hasVisualTransition = isPopStateVisualTransition;
      isPopStateVisualTransition = false;

      const conversionId = findCoverTransitionConversionId(
        fromLocation?.pathname,
        toLocation.pathname,
      );
      if (conversionId === undefined || hasVisualTransition || prefersReducedMotion()) {
        return false;
      }

      rule.replaceSync(
        `:root:active-view-transition-type(${COVER_TRANSITION_TYPE}) [data-track-cover="${CSS.escape(conversionId)}"] {
          view-transition-name: ${TRACK_COVER_TRANSITION_NAME};
        }`,
      );
      return [COVER_TRANSITION_TYPE];
    },
  };
}

/** A navigation's view transition that only cross-fades the screen, moving no cover. */
export const screenFadeViewTransition = supportsViewTransitionTypes() && {
  types: () => (prefersReducedMotion() ? false : [SCREEN_FADE_TYPE]),
};

/** Marks a cover as the given conversion's, to move when its detail view opens or closes. */
export function coverTransitionTarget(conversionId: string): { "data-track-cover": string } {
  return { "data-track-cover": conversionId };
}

function supportsViewTransitionTypes(): boolean {
  return (
    typeof window !== "undefined" &&
    window.CSS.supports("selector(:active-view-transition-type(a))")
  );
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function findCoverTransitionConversionId(
  fromPathname: string | undefined,
  toPathname: string,
): string | undefined {
  if (fromPathname === undefined) {
    return undefined;
  }

  const detailPathname = RECENTS_PATH.test(fromPathname)
    ? toPathname
    : RECENTS_PATH.test(toPathname)
      ? fromPathname
      : undefined;
  const encodedConversionId =
    detailPathname === undefined ? undefined : DETAIL_PATH.exec(detailPathname)?.[1];

  return encodedConversionId === undefined ? undefined : decodeURIComponent(encodedConversionId);
}
