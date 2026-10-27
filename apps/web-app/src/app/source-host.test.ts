import { expect, test } from "@playwright/test";

import { toSourceHost } from "#src/app/source-host.ts";

for (const [sourceUrl, host] of [
  ["https://www.derstandard.at/story/3000000", "derstandard.at"],
  ["https://theverge.com/ai", "theverge.com"],
  ["https://edition.cnn.com/2026/10/27/world", "edition.cnn.com"],
  ["http://localhost:8787/fixture", "localhost"],
] as const) {
  test(`the source host of ${sourceUrl} is ${host}`, () => {
    expect(toSourceHost(sourceUrl)).toBe(host);
  });
}

test("a source URL that does not parse shows as given", () => {
  expect(toSourceHost("not a URL")).toBe("not a URL");
});
