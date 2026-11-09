import {
  assertPublicSourceUrl,
  prepareLoadedSourcePage,
  VISIBLE_HEADLINE_ATTRIBUTE,
  type CoverImageDeclaration,
  type DeclaredLanguage,
  type SourceMaterialPreparer,
} from "#src/prepare-source-material.ts";

export type ControlledSourceMaterialPreparerOptions = {
  url: string;
  html: string;
  coverImage?: CoverImageDeclaration;
  declaredLanguage?: DeclaredLanguage;
};

/** Creates a deterministic source preparer backed by controlled HTML and production cleanup. */
export function createControlledSourceMaterialPreparer({
  url: controlledUrl,
  html,
  coverImage,
  declaredLanguage,
}: ControlledSourceMaterialPreparerOptions): SourceMaterialPreparer {
  assertPublicSourceUrl(controlledUrl);

  return async (url) => {
    if (url !== controlledUrl) {
      throw new Error(`Unexpected controlled source URL: ${url}`);
    }

    return prepareLoadedSourcePage({
      // Without a browser to render it, the controlled HTML's first `<h1>` is its visible headline.
      bodyHtml: html.replace("<h1", `<h1 ${VISIBLE_HEADLINE_ATTRIBUTE}`),
      documentTitle: "Controlled source fixture",
      ...(coverImage === undefined ? {} : { coverImage }),
      ...(declaredLanguage === undefined ? {} : { declaredLanguage }),
      responseStatus: 200,
    });
  };
}
