/**
 * What `cli.ts` checks and hands to `run.ts`. Playwright starts the run in a process of its own, so
 * the inputs travel through its environment.
 */
export type FidelityCheckInputs = {
  story: string;
  designImagePath: string;
  ignoreTopPixels: number;
};

const ENVIRONMENT_KEYS = {
  story: "FIDELITY_CHECK_STORY",
  designImagePath: "FIDELITY_CHECK_IMAGE",
  ignoreTopPixels: "FIDELITY_CHECK_IGNORE_TOP",
} as const;

const WHOLE_PIXELS = /^\d+$/;

/** Accepts only digits, so neither `""`, `1e2` nor `0x10` passes as a number of pixels. */
export function parseWholePixels(value: string): number {
  if (!WHOLE_PIXELS.test(value)) {
    throw new Error("Expected a whole number of pixels, such as 55.");
  }
  return Number(value);
}

export function toFidelityCheckEnvironment({
  story,
  designImagePath,
  ignoreTopPixels,
}: FidelityCheckInputs): Record<string, string> {
  return {
    [ENVIRONMENT_KEYS.story]: story,
    [ENVIRONMENT_KEYS.designImagePath]: designImagePath,
    [ENVIRONMENT_KEYS.ignoreTopPixels]: String(ignoreTopPixels),
  };
}

export function readFidelityCheckEnvironment(
  environment: Record<string, string | undefined>,
): FidelityCheckInputs {
  const story = environment[ENVIRONMENT_KEYS.story];
  const designImagePath = environment[ENVIRONMENT_KEYS.designImagePath];
  const ignoreTopPixels = environment[ENVIRONMENT_KEYS.ignoreTopPixels];
  if (story === undefined || designImagePath === undefined || ignoreTopPixels === undefined) {
    throw new Error(
      "Run the fidelity check through its command: pnpm --filter '@cup/web-app' fidelity-check --help",
    );
  }
  return { story, designImagePath, ignoreTopPixels: parseWholePixels(ignoreTopPixels) };
}
