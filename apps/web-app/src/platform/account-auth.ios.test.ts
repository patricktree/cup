import { expect, test, type Page } from "@playwright/test";

type SignInRecord = {
  oauthOptions?: unknown;
  authenticatedUrl?: unknown;
  exchangedCode?: unknown;
  error?: string;
};

/**
 * Runs the iOS adapter's Google sign-in against a fake Supabase client, with the native
 * `WebAuthentication` plugin answering `callbackUrl`, and records what each side received.
 */
async function signIn(
  page: Page,
  callbackUrl: string,
  signInOptions: { fresh: boolean; chooseAccount: boolean } = {
    fresh: false,
    chooseAccount: false,
  },
): Promise<SignInRecord> {
  await page.addInitScript((url) => {
    Object.assign(window, {
      webkit: { messageHandlers: { bridge: {} } },
      Capacitor: {
        PluginHeaders: [
          { name: "WebAuthentication", methods: [{ name: "authenticate", rtype: "promise" }] },
        ],
        nativePromise: async (plugin: string, method: string, options: { url: string }) => {
          if (plugin !== "WebAuthentication" || method !== "authenticate") {
            throw new Error(`Unexpected native call ${plugin}.${method}`);
          }
          Object.assign(window, { authenticatedUrl: options.url });
          return { url };
        },
      },
    });
  }, callbackUrl);
  // The gallery page serves the app's modules; nothing needs to be mounted.
  await page.goto("");
  return page.evaluate(async (requestedOptions) => {
    const modulePath = "/src/platform/account-auth.ios.ts";
    const { signInWithGoogle } = await import(modulePath);
    const record: SignInRecord = {};
    const client = {
      auth: {
        signInWithOAuth: async (credentials: { options: unknown }) => {
          record.oauthOptions = credentials.options;
          return {
            data: { url: "https://auth.example.test/auth/v1/authorize?state=1" },
            error: null,
          };
        },
        exchangeCodeForSession: async (code: string) => {
          record.exchangedCode = code;
          return { data: {}, error: null };
        },
      },
    };
    try {
      await signInWithGoogle(client, undefined, requestedOptions);
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error);
    }
    record.authenticatedUrl = Reflect.get(window, "authenticatedUrl");
    return record;
  }, signInOptions);
}

test("signs in through the system browser sheet and exchanges the returned code", async ({
  page,
}) => {
  const record = await signIn(page, "audio.cup.app://auth/callback?code=the-code");

  expect(record).toEqual({
    oauthOptions: {
      redirectTo: "audio.cup.app://auth/callback",
      skipBrowserRedirect: true,
      queryParams: {},
    },
    authenticatedUrl: "https://auth.example.test/auth/v1/authorize?state=1",
    exchangedCode: "the-code",
  });
});

test("asks Google for its account chooser when the session lifecycle asks for it", async ({
  page,
}) => {
  const record = await signIn(page, "audio.cup.app://auth/callback?code=the-code", {
    fresh: false,
    chooseAccount: true,
  });

  expect(record.oauthOptions).toMatchObject({ queryParams: { prompt: "select_account" } });
  expect(record.exchangedCode).toBe("the-code");
});

test("asks Google for the account chooser and a new authentication on a fresh sign-in", async ({
  page,
}) => {
  const record = await signIn(page, "audio.cup.app://auth/callback?code=the-code", {
    fresh: true,
    chooseAccount: false,
  });

  expect(record.oauthOptions).toMatchObject({
    queryParams: { prompt: "select_account", max_age: "0" },
  });
  expect(record.exchangedCode).toBe("the-code");
});

test("reports the provider's error and exchanges nothing when the callback has no code", async ({
  page,
}) => {
  const record = await signIn(
    page,
    "audio.cup.app://auth/callback#error=access_denied&error_description=The+user+declined",
  );

  expect(record.error).toBe("The user declined");
  expect(record.exchangedCode).toBeUndefined();
});
