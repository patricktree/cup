import { parseFragment } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import { z } from "zod";

import type {
  SelectionCompletion,
  SelectionCompletionOptions,
  SelectionTool,
} from "#src/narration-content-selection.ts";

/**
 * The language a source page declares for itself, each value exactly as declared and absent when
 * the page does not declare it. Values may be malformed; detection validates them.
 */
export type DeclaredLanguage = {
  /** The `lang` attribute of the page's `<html>` element. */
  htmlLang?: string;
  /** The `og:locale` metadata, often in underscore form such as `de_AT`. */
  ogLocale?: string;
};

export type NarrationLanguageDetectionInput = {
  sourceTitle: string;
  /** The narration source material: the HTML that narration content selection kept. */
  sourceMaterialHtml: string;
  declaredLanguage?: DeclaredLanguage;
};

export type NarrationLanguageDetectionConfig = {
  completion: SelectionCompletion;
  systemPrompt: string;
  tool: SelectionTool;
  completionOptions: SelectionCompletionOptions;
};

/** Why detection fell back from the detector's answer to the declared language or to none. */
export type NarrationLanguageFallbackReason = "detector-error" | "invalid-tag" | "no-answer";

export type NarrationLanguageDetectionResult = {
  /** A canonical BCP 47 tag, absent when the conversion has no narration language. */
  narrationLanguage?: string;
  /** Present only when detection fell back. */
  fallbackReason?: NarrationLanguageFallbackReason;
  /** Why the detector call failed; present only when detection fell back with `detector-error`. */
  detectorError?: unknown;
};

/** The detector's raw, unvalidated answer; `null` when it gave none. */
export type NarrationLanguageAnswer = { language: string | null };

/**
 * Runs the one detector call, for example as a retryable workflow step. A rejection makes detection
 * fall back with `detector-error`.
 */
export type NarrationLanguageDetectionRunner = (
  detect: () => Promise<NarrationLanguageAnswer>,
) => Promise<NarrationLanguageAnswer>;

export const DETECTION_ARGS_SCHEMA = z.object({ language: z.string() }).strict();

const MAX_TEXT_CHARACTERS = 8_000;
const DETECTION_REQUEST_TIMEOUT_MILLISECONDS = 60_000;
/** Undetermined, multiple languages, uncoded languages and no linguistic content. */
const NON_LANGUAGE_SUBTAGS = new Set(["und", "mul", "mis", "zxx"]);
const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });

/** Creates a detector that decides a conversion's narration language and never rejects. */
export function createNarrationLanguageDetector(configuration: NarrationLanguageDetectionConfig) {
  return async function detectNarrationLanguage(
    input: NarrationLanguageDetectionInput,
    {
      conversionId,
      runDetection = (detect) => detect(),
    }: { conversionId?: string; runDetection?: NarrationLanguageDetectionRunner } = {},
  ): Promise<NarrationLanguageDetectionResult> {
    const declaredLanguage = toValidDeclaredLanguage(input.declaredLanguage);

    let answer: NarrationLanguageAnswer;
    try {
      answer = await runDetection(() =>
        requestAnswer(configuration, input, conversionId === undefined ? {} : { conversionId }),
      );
    } catch (error) {
      return { ...fallBack(declaredLanguage, "detector-error"), detectorError: error };
    }

    if (answer.language === null) {
      return fallBack(declaredLanguage, "no-answer");
    }

    const language = toLanguageSubtag(answer.language);
    if (language === undefined) {
      return fallBack(declaredLanguage, "invalid-tag");
    }

    return { narrationLanguage: withDeclaredRegion(language, declaredLanguage) };
  };
}

async function requestAnswer(
  configuration: NarrationLanguageDetectionConfig,
  input: NarrationLanguageDetectionInput,
  { conversionId }: { conversionId?: string },
): Promise<NarrationLanguageAnswer> {
  const response = await configuration.completion(
    {
      systemPrompt: configuration.systemPrompt,
      userPrompt: createUserPrompt(input),
      tool: configuration.tool,
    },
    {
      ...configuration.completionOptions,
      signal: AbortSignal.timeout(DETECTION_REQUEST_TIMEOUT_MILLISECONDS),
      ...(conversionId === undefined
        ? {}
        : { gatewayMetadata: { conversionId, stage: "narration-language-detection" } }),
    },
  );
  const toolCall = response.toolCalls.find((call) => call.name === configuration.tool.name);
  const parsed = DETECTION_ARGS_SCHEMA.safeParse(toolCall?.arguments);
  const language = parsed.success ? parsed.data.language.trim() : "";

  return { language: language === "" ? null : language };
}

function createUserPrompt({
  sourceTitle,
  sourceMaterialHtml,
  declaredLanguage,
}: NarrationLanguageDetectionInput) {
  const declarations = [
    `<html lang>: ${declaredLanguage?.htmlLang ?? "(not declared)"}`,
    `og:locale: ${declaredLanguage?.ogLocale ?? "(not declared)"}`,
  ].join("\n");

  return [
    `<source-title>\n${sourceTitle}\n</source-title>`,
    `<declared-language>\n${declarations}\n</declared-language>`,
    `<narrated-text>\n${extractText(sourceMaterialHtml).slice(0, MAX_TEXT_CHARACTERS)}\n</narrated-text>`,
  ].join("\n\n");
}

function extractText(html: string): string {
  const parts: string[] = [];
  const visit = (
    node: DefaultTreeAdapterMap["childNode"] | DefaultTreeAdapterMap["documentFragment"],
  ) => {
    if (node.nodeName === "#text" && "value" in node) {
      parts.push(node.value);
      return;
    }
    if ("tagName" in node && (node.tagName === "script" || node.tagName === "style")) {
      return;
    }
    if ("childNodes" in node) {
      for (const child of node.childNodes) {
        parts.push(" ");
        visit(child);
      }
    }
  };
  visit(parseFragment(html));

  return parts.join("").replaceAll(/\s+/gu, " ").trim();
}

function fallBack(
  declaredLanguage: Intl.Locale | undefined,
  fallbackReason: NarrationLanguageFallbackReason,
): NarrationLanguageDetectionResult {
  return {
    ...(declaredLanguage === undefined ? {} : { narrationLanguage: declaredLanguage.toString() }),
    fallbackReason,
  };
}

/** Adds the declared region only when the declared language has the same language subtag. */
function withDeclaredRegion(language: string, declaredLanguage: Intl.Locale | undefined): string {
  if (declaredLanguage?.language !== language || declaredLanguage.region === undefined) {
    return language;
  }

  return new Intl.Locale(language, { region: declaredLanguage.region }).toString();
}

/** `<html lang>` wins over `og:locale`, whose underscore form is converted to BCP 47 first. */
function toValidDeclaredLanguage(declared: DeclaredLanguage | undefined): Intl.Locale | undefined {
  return toLocale(declared?.htmlLang) ?? toLocale(declared?.ogLocale?.replaceAll("_", "-"));
}

function toLanguageSubtag(tag: string): string | undefined {
  return toLocale(tag)?.language;
}

function toLocale(tag: string | undefined): Intl.Locale | undefined {
  if (tag === undefined) {
    return undefined;
  }

  let locale: Intl.Locale;
  try {
    const [canonical] = Intl.getCanonicalLocales(tag.trim());
    if (canonical === undefined) {
      return undefined;
    }

    locale = new Intl.Locale(canonical);
  } catch {
    return undefined;
  }

  return isNamedLanguage(locale.language) ? locale : undefined;
}

/**
 * BCP 47 also admits 5–8 letter language subtags, so a language name such as "German" parses as
 * the tag `german`. Only a 2–3 letter ISO 639 subtag that `Intl` can name is a language, and the
 * ISO 639 special codes name none.
 */
function isNamedLanguage(language: string | undefined): language is string {
  if (
    language === undefined ||
    !/^[a-z]{2,3}$/u.test(language) ||
    NON_LANGUAGE_SUBTAGS.has(language)
  ) {
    return false;
  }

  return LANGUAGE_NAMES.of(language) !== undefined;
}
