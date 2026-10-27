/** A `boundaries.tags` rule of the root `turbo.jsonc`. */
export type TagRule = { dependencies?: { deny?: string[] | undefined } | undefined };

export type LibraryTags = { library: string; tags: string[] };

const LAYER_TAG_PREFIX = "layer:";

/**
 * `turbo boundaries` enforces the library layers through `layer:*` tags and deny lists in the root
 * `turbo.jsonc`, but it skips a library without a tag and cannot tell a deny list that forgot a
 * layer. This reports both: every library needs exactly one layer tag the root declares, and each
 * layer, in declaration order from the bottom up, must deny its own tag and every tag above it.
 */
export function findLayerConfigProblems(
  tagRules: Record<string, TagRule>,
  libraries: LibraryTags[],
): string[] {
  const layerTags = Object.keys(tagRules).filter((tag) => tag.startsWith(LAYER_TAG_PREFIX));
  const problems: string[] = [];

  for (const [rank, layerTag] of layerTags.entries()) {
    const deniedTags = tagRules[layerTag]?.dependencies?.deny ?? [];
    const expectedDeniedTags = layerTags.slice(rank);
    if (deniedTags.join() !== expectedDeniedTags.join()) {
      problems.push(
        `\`${layerTag}\` denies [${deniedTags.join(", ")}] but must deny its own tag and every layer above it, in order: [${expectedDeniedTags.join(", ")}].`,
      );
    }
  }

  for (const { library, tags } of libraries) {
    const libraryLayerTags = tags.filter((tag) => tag.startsWith(LAYER_TAG_PREFIX));
    if (libraryLayerTags.length !== 1) {
      problems.push(
        `\`${library}\` has ${libraryLayerTags.length} layer tags; give its \`turbo.jsonc\` exactly one of: ${layerTags.join(", ")}.`,
      );
      continue;
    }

    const [layerTag] = libraryLayerTags;
    if (layerTag !== undefined && !layerTags.includes(layerTag)) {
      problems.push(
        `\`${library}\` has the tag \`${layerTag}\`, which the root \`turbo.jsonc\` does not declare.`,
      );
    }
  }
  return problems;
}
