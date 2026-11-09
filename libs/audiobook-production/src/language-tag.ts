/** Tells whether a value is a BCP 47 tag in its canonical form, such as `de-AT` but not `de-at`. */
export function isCanonicalLanguageTag(tag: string): boolean {
  try {
    return Intl.getCanonicalLocales(tag)[0] === tag;
  } catch {
    return false;
  }
}

/** The language subtag of a BCP 47 tag: `de` for `de-AT`. */
export function toLanguageSubtag(tag: string): string {
  return new Intl.Locale(tag).language;
}
