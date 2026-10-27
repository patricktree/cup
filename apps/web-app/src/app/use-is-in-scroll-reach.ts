import { check } from "@patricktree-stack/utils-ecma/assert.utils";
import React from "react";

/**
 * Reports whether an element is within about one screen of the visible part of its scroll
 * container, for an infinite-scroll sentinel after a list. Returns a ref callback for the element
 * and whether it is in reach.
 */
export function useIsInScrollReach(): [React.RefCallback<HTMLElement>, boolean] {
  const [isInReach, setIsInReach] = React.useState(false);

  const ref = React.useCallback((element: HTMLElement | null) => {
    // React calls the returned cleanup instead of passing null
    check.assert(element, "A ref callback with a cleanup is never called with null.");

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (entry) {
          setIsInReach(entry.isIntersecting);
        }
      },
      {
        /*
         * The root margin extends only the root; with the viewport as root, a scrolling ancestor
         * such as the shell's <main> would still clip the sentinel until it scrolls into view.
         */
        root: findScrollContainer(element),
        // percentages refer to the root's size: one screen above and below
        rootMargin: "100% 0px",
      },
    );
    observer.observe(element);

    return () => {
      observer.disconnect();
      setIsInReach(false);
    };
  }, []);

  return [ref, isInReach];
}

/** The nearest ancestor that scrolls vertically, or `null` for the viewport. */
function findScrollContainer(element: HTMLElement): HTMLElement | null {
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const { overflowY } = getComputedStyle(ancestor);
    if (overflowY === "auto" || overflowY === "scroll") {
      return ancestor;
    }
  }

  return null;
}
