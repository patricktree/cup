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

    const resizeObserver = new ResizeObserver((entries) => {
      const gap = Number.parseFloat(getComputedStyle(list).columnGap) || 0;
      for (const entry of entries) {
        if (entry.target instanceof HTMLElement) {
          const height = entry.target.getBoundingClientRect().height;
          entry.target.style.gridRowEnd = `span ${Math.ceil(height + gap)}`;
        }
      }
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
