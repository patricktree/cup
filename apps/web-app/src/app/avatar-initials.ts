const STARTS_WITH_LETTER = /^\p{L}/u;

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * The avatar's initials from the account holder's display name: the first letter grapheme of the
 * first and of the last word, skipping words without a letter. The name is shown as written, so
 * family-name-first names keep their order; the avatar lowercases with CSS. Returns `undefined`
 * when the name has no letter, and the avatar shows its glyph instead.
 */
export function toAvatarInitials(name: unknown): string | undefined {
  if (typeof name !== "string") {
    return undefined;
  }

  const letterGraphemes = name
    .normalize("NFC")
    .split(/\s+/u)
    .map(firstLetterGrapheme)
    .filter((grapheme) => grapheme !== undefined);

  const first = letterGraphemes.at(0);
  if (first === undefined) {
    return undefined;
  }

  return letterGraphemes.length === 1 ? first : `${first}${letterGraphemes.at(-1)}`;
}

/** Graphemes keep a decomposed accent or a surrogate pair together, where `word[0]` would split it. */
function firstLetterGrapheme(word: string): string | undefined {
  for (const { segment } of graphemeSegmenter.segment(word)) {
    if (STARTS_WITH_LETTER.test(segment)) {
      return segment;
    }
  }
  return undefined;
}
