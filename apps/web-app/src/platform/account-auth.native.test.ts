import { expect, type Page, test } from "@playwright/test";

type Shell = "android" | "ios";

/** An item in the fake native store, with the Keychain accessibility it was written with. */
type StoredItem = { data: string; access: unknown };

type StorageRecord = {
  read: string | null;
  items: Record<string, StoredItem>;
};

const SESSION_KEY = "cup-account-session";
const PREFIXED_SESSION_KEY = `capacitor-storage_${SESSION_KEY}`;

/**
 * Initializes the shell's session storage against a fake native Secure Storage plugin holding
 * `existingItems`, reads the session item, writes `written` under it, and reports what was read and
 * what the native store holds afterwards.
 */
async function readThenWriteSession(
  page: Page,
  shell: Shell,
  existingItems: Record<string, StoredItem>,
  written: string,
): Promise<StorageRecord> {
  await page.addInitScript(
    ({ platform, items }) => {
      const store: Record<string, StoredItem> = { ...items };
      Object.assign(window, {
        ...(platform === "ios"
          ? { webkit: { messageHandlers: { bridge: {} } } }
          : { androidBridge: {} }),
        nativeStore: store,
        Capacitor: {
          PluginHeaders: [
            {
              name: "SecureStorage",
              methods: [
                { name: "internalSetItem", rtype: "promise" },
                { name: "internalGetItem", rtype: "promise" },
                { name: "internalRemoveItem", rtype: "promise" },
              ],
            },
          ],
          nativePromise: async (
            plugin: string,
            method: string,
            options: { prefixedKey: string; data?: string; access?: unknown },
          ) => {
            if (plugin !== "SecureStorage") {
              throw new Error(`Unexpected native call ${plugin}.${method}`);
            }
            if (method === "internalSetItem") {
              store[options.prefixedKey] = { data: options.data ?? "", access: options.access };
              return {};
            }
            if (method === "internalGetItem") {
              // Like the Keychain query, a read matches an item whatever its accessibility.
              return { data: store[options.prefixedKey]?.data ?? null };
            }
            throw new Error(`Unexpected native call ${plugin}.${method}`);
          },
        },
      });
    },
    { platform: shell, items: existingItems },
  );
  // The gallery page serves the app's modules; nothing needs to be mounted.
  await page.goto("");
  return page.evaluate(
    async ({ platform, key, value }) => {
      const modulePath = `/src/platform/account-auth.${platform}.ts`;
      const { initializeAuthStorage } = await import(modulePath);
      const { storage } = await initializeAuthStorage([key]);
      const read: string | null = await storage.getItem(key);
      await storage.setItem(key, value);
      return { read, items: Reflect.get(window, "nativeStore") };
    },
    { platform: shell, key: SESSION_KEY, value: written },
  );
}

test("the iOS shell writes the session readable after the device's first unlock", async ({
  page,
}) => {
  const record = await readThenWriteSession(page, "ios", {}, "the-session");

  // 2 is the plugin's `KeychainAccess.afterFirstUnlock`.
  expect(record.items).toEqual({ [PREFIXED_SESSION_KEY]: { data: "the-session", access: 2 } });
});

test("the iOS shell reads a session stored before the update and rewrites it after first unlock", async ({
  page,
}) => {
  // 0 is the plugin's default, `KeychainAccess.whenUnlocked`, which earlier versions wrote.
  const record = await readThenWriteSession(
    page,
    "ios",
    { [PREFIXED_SESSION_KEY]: { data: "the-old-session", access: 0 } },
    "the-refreshed-session",
  );

  expect(record).toEqual({
    read: "the-old-session",
    items: { [PREFIXED_SESSION_KEY]: { data: "the-refreshed-session", access: 2 } },
  });
});

test("the Android shell writes the session with the plugin's default access", async ({ page }) => {
  const record = await readThenWriteSession(page, "android", {}, "the-session");

  // Android ignores the access option; the plugin sends its default, `KeychainAccess.whenUnlocked`.
  expect(record.items).toEqual({ [PREFIXED_SESSION_KEY]: { data: "the-session", access: 0 } });
});
