import type { ParsedLocation } from "@tanstack/react-router";
import React from "react";

/**
 * Opening a track from Recents, and going back from its detail view to Recents, moves the track's
 * cover from where it was to where it lands, in a View Transition that the router starts for the
 * navigation. Only the track's own covers carry the transition name, and only while it runs: a
 * second element with the same name would make the browser skip the whole transition.
 */
// The global styles shape the moving cover's corners by these types, and time it by this name.
const COVER_TRANSITION_TYPE_OPEN = "track-cover-open";
const COVER_TRANSITION_TYPE_CLOSE = "track-cover-close";
const COVER_TRANSITION_NAME = "track-cover";
const SCREEN_FADE_TYPE = "screen-fade";

const RECENTS_PATH = /\/recent\/?$/;
const DETAIL_PATH = /\/audiobooks\/([^/]+)\/?$/;

/**
 * The mounted covers of each conversion that take part in the cover transition: a Recents card, a
 * detail view.
 */
const coversByConversionId = new Map<string, Set<HTMLElement>>();
const namedCovers = new Set<HTMLElement>();

/**
 * The conversion whose cover the latest navigation moves. It stays set after the landing cover
 * mounts, because StrictMode attaches a ref twice and the second attach has to name the cover
 * again.
 */
let coverTransitionConversionId: string | undefined;
let isListeningToPopState = false;
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

  // A swipe-back on iOS Safari already animates the page; a second animation would replay it.
  if (!isListeningToPopState) {
    isListeningToPopState = true;
    window.addEventListener(
      "popstate",
      (event) => {
        isPopStateVisualTransition = event.hasUAVisualTransition;
      },
      { capture: true },
    );
  }

  return {
    types: ({ fromLocation, toLocation }) => {
      const hasVisualTransition = isPopStateVisualTransition;
      isPopStateVisualTransition = false;
      clearCoverNames();
      coverTransitionConversionId = undefined;

      const conversionId = findCoverTransitionConversionId(
        fromLocation?.pathname,
        toLocation.pathname,
      );
      if (
        conversionId === undefined ||
        hasVisualTransition ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return false;
      }

      // Still the previous screen: name the cover that the transition starts from.
      nameCoverOf(conversionId);
      coverTransitionConversionId = conversionId;
      return [
        fromLocation !== undefined && RECENTS_PATH.test(fromLocation.pathname)
          ? COVER_TRANSITION_TYPE_OPEN
          : COVER_TRANSITION_TYPE_CLOSE,
      ];
    },
  };
}

/**
 * A navigation's view transition that only cross-fades the screen, moving no cover. The router does
 * not ask the setting above for such a navigation, so this clears a name that an earlier cover
 * transition left on a card; that card would still animate otherwise.
 */
export const screenFadeViewTransition = supportsViewTransitionTypes() && {
  types: () => {
    clearCoverNames();
    coverTransitionConversionId = undefined;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? false
      : [SCREEN_FADE_TYPE];
  },
};

/**
 * Registers a cover as the given conversion's, to move when its detail view opens or closes. The
 * cover that a navigation lands on mounts in the router's commit, before the browser captures the
 * new screen, and takes the name then.
 */
export function useCoverTransitionRef(conversionId: string): React.RefCallback<HTMLElement> {
  return React.useCallback(
    (cover: HTMLElement | null) => {
      // React calls the cleanup instead of passing null.
      if (cover === null) {
        return undefined;
      }

      const covers = coversByConversionId.get(conversionId) ?? new Set();
      covers.add(cover);
      coversByConversionId.set(conversionId, covers);
      if (coverTransitionConversionId === conversionId) {
        nameCoverOf(conversionId);
      }

      return () => {
        covers.delete(cover);
        namedCovers.delete(cover);
        if (covers.size === 0) {
          coversByConversionId.delete(conversionId);
        }
      };
    },
    [conversionId],
  );
}

function supportsViewTransitionTypes(): boolean {
  return (
    typeof window !== "undefined" &&
    window.CSS.supports("selector(:active-view-transition-type(a))")
  );
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

function nameCoverOf(conversionId: string) {
  const covers = coversByConversionId.get(conversionId);
  // A missing cover, such as a deleted track's card, leaves the other screen's cover to fade.
  if (covers?.size !== 1) {
    return;
  }

  const [cover] = covers;
  if (cover !== undefined) {
    cover.style.viewTransitionName = COVER_TRANSITION_NAME;
    namedCovers.add(cover);
  }
}

function clearCoverNames() {
  for (const cover of namedCovers) {
    cover.style.viewTransitionName = "";
  }
  namedCovers.clear();
}
