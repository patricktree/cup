import { check } from "@patricktree-stack/utils-ecma/assert.utils";
import React from "react";

/**
 * Lays out a list's items as masonry on a CSS grid with 1 px rows: each item spans as many rows as
 * its measured height plus the grid's column gap, which also serves as the gap between items in a
 * column. Auto-placement then puts every item into the column that ends highest, so the DOM order
 * (and with it focus and reading order) runs left to right, top down, and appended items never move
 * earlier ones.
 *
 * Returns a ref callback for the list. The list carries `data-masonry` while the hook is active;
 * its styles switch to 1 px rows only then, so without the hook the list stays an ordinary grid.
 * Items must not stretch (`align-self: start`), or the observer would measure the spanned area.
 *
 * Why not `display: grid-lanes` or multi-column: docs/research/recents-masonry-layout.md.
 */
export function useMasonryRowSpans(): React.RefCallback<HTMLElement> {
  return React.useCallback((list: HTMLElement | null) => {
    // React calls the returned cleanup instead of passing null
    check.assert(list, "A ref callback with a cleanup is never called with null.");

    const spanMeasuredHeights = (items: Iterable<Element>) => {
      const gap = Number.parseFloat(getComputedStyle(list).columnGap) || 0;
      for (const item of items) {
        if (item instanceof HTMLElement) {
          const height = item.getBoundingClientRect().height;
          item.style.gridRowEnd = `span ${Math.ceil(height + gap)}`;
        }
      }
    };

    // Before the 1 px rows apply, so a list rendered with its items, such as Recents shown again
    // from the cache, has its full height when the router restores the scroll position after the
    // render; the observer below would only measure the items a frame later.
    spanMeasuredHeights(list.children);

    const resizeObserver = new ResizeObserver((entries) => {
      spanMeasuredHeights(entries.map((entry) => entry.target));
    });
    for (const item of list.children) {
      resizeObserver.observe(item);
    }

    // items of appended pages and newly added conversions are observed as React inserts them
    const mutationObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) {
            resizeObserver.observe(node);
          }
        }
        for (const node of record.removedNodes) {
          if (node instanceof Element) {
            resizeObserver.unobserve(node);
          }
        }
      }
    });
    mutationObserver.observe(list, { childList: true });

    list.dataset["masonry"] = "";

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      delete list.dataset["masonry"];
    };
  }, []);
}
