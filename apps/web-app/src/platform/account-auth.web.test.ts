import type { Page } from "@playwright/test";

import { expect, test } from "#src/test-utils/component-test.ts";

/**
 * Runs the web adapter's Google sign-in against a fake Supabase client and returns the OAuth
 * options it passed, whose query parameters Supabase forwards to Google.
 */
async function signIn(
  page: Page,
  options: { fresh: boolean; chooseAccount: boolean },
): Promise<unknown> {
  // The gallery page serves the app's modules; nothing needs to be mounted.
  await page.goto("");
  return page.evaluate(async (signInOptions) => {
    const modulePath = "/src/platform/account-auth.web.ts";
    const { signInWithGoogle } = await import(modulePath);
    let oauthOptions: unknown;
    const client = {
      auth: {
        signInWithOAuth: async (credentials: { options: unknown }) => {
          oauthOptions = credentials.options;
          return { data: {}, error: null };
        },
      },
    };
    await signInWithGoogle(client, undefined, signInOptions);
    return oauthOptions;
  }, options);
}

test("a normal sign-in leaves Google free to skip its account chooser", async ({ page }) => {
  const oauthOptions = await signIn(page, { fresh: false, chooseAccount: false });

  expect(oauthOptions).toMatchObject({ queryParams: {} });
  expect(oauthOptions).not.toHaveProperty("queryParams.prompt");
  expect(oauthOptions).not.toHaveProperty("queryParams.max_age");
});

test("asks Google for its account chooser when the session lifecycle asks for it", async ({
  page,
}) => {
  const oauthOptions = await signIn(page, { fresh: false, chooseAccount: true });

  expect(oauthOptions).toMatchObject({ queryParams: { prompt: "select_account" } });
  expect(oauthOptions).not.toHaveProperty("queryParams.max_age");
});

test("asks Google for the account chooser and a new authentication on a fresh sign-in", async ({
  page,
}) => {
  const oauthOptions = await signIn(page, { fresh: true, chooseAccount: false });

  expect(oauthOptions).toMatchObject({
    queryParams: { prompt: "select_account", max_age: "0" },
  });
});
