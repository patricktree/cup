import type { ParsedLocation } from "@tanstack/react-router";
import React from "react";

/**
 * Opening a track from Recents, and going back from its detail view to Recents, moves the track's
 * cover from where it was to where it lands, in a View Transition that the router starts for the
 * navigation. Only the track's own covers carry the transition name, and only while it runs: a
 * second element with the same name would make the browser skip the whole transition.
 */
const COVER_TRANSITION_TYPE = "track-cover";
// The global styles time the cover transition by this name.
const COVER_TRANSITION_NAME = "track-cover";

const RECENTS_PATH = /\/recent\/?$/;
const DETAIL_PATH = /\/audiobooks\/([^/]+)\/?$/;

/**
 * The mounted covers of each conversion that take part in the cover transition: a Recents card, a
 * detail view.
 */
const coversByConversionId = new Map<string, Set<HTMLElement>>();
const namedCovers = new Set<HTMLElement>();

/** The conversion whose cover the running navigation moves, until its landing cover mounts. */
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
  if (
    typeof window === "undefined" ||
    !window.CSS?.supports?.("selector(:active-view-transition-type(a))")
  ) {
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
      return [COVER_TRANSITION_TYPE];
    },
  };
}

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
        coverTransitionConversionId = undefined;
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
