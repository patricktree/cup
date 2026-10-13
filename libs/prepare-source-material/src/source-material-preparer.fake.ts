import {
  assertPublicSourceUrl,
  prepareLoadedSourcePage,
  type HeroImageDeclaration,
  type SourceMaterialPreparer,
} from "#src/prepare-source-material.ts";

export type ControlledSourceMaterialPreparerOptions = {
  url: string;
  html: string;
  heroImage?: HeroImageDeclaration;
};

/** Creates a deterministic source preparer backed by controlled HTML and production cleanup. */
export function createControlledSourceMaterialPreparer({
  url: controlledUrl,
  html,
  heroImage,
}: ControlledSourceMaterialPreparerOptions): SourceMaterialPreparer {
  assertPublicSourceUrl(controlledUrl);

  return async (url) => {
    if (url !== controlledUrl) {
      throw new Error(`Unexpected controlled source URL: ${url}`);
    }

    return prepareLoadedSourcePage({
      bodyHtml: html,
      documentTitle: "Controlled source fixture",
      ...(heroImage === undefined ? {} : { heroImage }),
      responseStatus: 200,
    });
  };
}
