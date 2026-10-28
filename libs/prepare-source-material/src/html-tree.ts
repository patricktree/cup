import type { DefaultTreeAdapterMap } from "parse5";

export type HtmlElement = DefaultTreeAdapterMap["element"];
export type HtmlParentNode = DefaultTreeAdapterMap["parentNode"];

/** A `<meta>` declaration, keyed by its `property` or `name`. */
export type Metadata = { property: string; content: string };

export const NARRATION_TEXT_ELEMENT_TAG_NAMES = new Set<string>([
  "blockquote",
  "figcaption",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "p",
  "pre",
  "td",
  "th",
]);

/** Options for {@link findFirstElement}. */
type FindFirstElementOptions = {
  /**
   * Whether the walk looks inside an element that does not match; it looks inside every one by
   * default.
   */
  shouldDescend?: (element: HtmlElement) => boolean;
};

export function getAttribute(element: HtmlElement, name: string): string | undefined {
  return element.attrs.find((attribute) => attribute.name === name)?.value;
}

/**
 * The element's child elements, for a `<template>` those of its content, which parse5 keeps apart
 * from its child nodes. Every walk in this package goes through here, so all of them treat
 * `<template>` content alike.
 */
function getChildElements(parentNode: HtmlParentNode): HtmlElement[] {
  const contentNode =
    "tagName" in parentNode && isTemplateElement(parentNode) ? parentNode.content : parentNode;

  return contentNode.childNodes.filter((childNode) => "tagName" in childNode);
}

/** Finds the first descendant element in document order that matches. */
export function findFirstElement(
  parentNode: HtmlParentNode,
  isMatch: (element: HtmlElement) => boolean,
  { shouldDescend = () => true }: FindFirstElementOptions = {},
): HtmlElement | undefined {
  for (const childElement of getChildElements(parentNode)) {
    if (isMatch(childElement)) {
      return childElement;
    }

    const descendant = shouldDescend(childElement)
      ? findFirstElement(childElement, isMatch, { shouldDescend })
      : undefined;

    if (descendant) {
      return descendant;
    }
  }

  return undefined;
}

/** Finds every descendant element in document order, including descendants of a match. */
export function findAllElements(
  parentNode: HtmlParentNode,
  isMatch: (element: HtmlElement) => boolean,
): HtmlElement[] {
  return getChildElements(parentNode).flatMap((childElement) => [
    ...(isMatch(childElement) ? [childElement] : []),
    ...findAllElements(childElement, isMatch),
  ]);
}

/** The text of the node; each element `isExcluded` accepts contributes a single space instead. */
export function extractNodeText(
  parentNode: HtmlParentNode,
  isExcluded: (element: HtmlElement) => boolean = () => false,
): string {
  return parentNode.childNodes
    .map((childNode) => {
      if ("value" in childNode) {
        return childNode.value;
      }

      if (!("tagName" in childNode)) {
        return "";
      }

      return isExcluded(childNode) ? " " : extractNodeText(childNode, isExcluded);
    })
    .join("");
}

export function collectMetadata(parentNode: HtmlParentNode): Metadata[] {
  return findAllElements(parentNode, (element) => element.tagName === "meta").flatMap(
    (metaElement) => {
      // Open Graph uses `property`; Twitter cards and many publishers use `name` for either.
      const property = (getAttribute(metaElement, "property") ?? getAttribute(metaElement, "name"))
        ?.trim()
        .toLowerCase();
      const content = normalizeWhitespace(getAttribute(metaElement, "content") ?? "");

      return property && content.length > 0 ? [{ property, content }] : [];
    },
  );
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

export function isTemplateElement(
  element: HtmlElement,
): element is DefaultTreeAdapterMap["template"] {
  return element.tagName === "template" && "content" in element;
}
