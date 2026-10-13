import {
  assertPublicSourceUrl,
  prepareLoadedSourcePage,
  type CoverImageDeclaration,
  type SourceMaterialPreparer,
} from "#src/prepare-source-material.ts";

export type ControlledSourceMaterialPreparerOptions = {
  url: string;
  html: string;
  coverImage?: CoverImageDeclaration;
};

/** Creates a deterministic source preparer backed by controlled HTML and production cleanup. */
export function createControlledSourceMaterialPreparer({
  url: controlledUrl,
  html,
  coverImage,
}: ControlledSourceMaterialPreparerOptions): SourceMaterialPreparer {
  assertPublicSourceUrl(controlledUrl);

  return async (url) => {
    if (url !== controlledUrl) {
      throw new Error(`Unexpected controlled source URL: ${url}`);
    }

    return prepareLoadedSourcePage({
      bodyHtml: html,
      documentTitle: "Controlled source fixture",
      ...(coverImage === undefined ? {} : { coverImage }),
      responseStatus: 200,
    });
  };
}
