import { expect, test } from "@playwright/test";

import { toAvatarInitials } from "#src/app/avatar-initials.ts";

const INITIALS = [
  ["Verena Handler-Kunze", "VH"],
  ["Cher", "C"],
  ["Ludwig van Beethoven", "LB"],
  ["山田 太郎", "山太"],
  ["  Anna 🌸  ", "A"],
  ["(Bob) Dylan", "BD"],
  // "E" followed by a combining acute accent stays one grapheme.
  ["Émile Zola", "ÉZ"],
] as const;

for (const [name, initials] of INITIALS) {
  test(`"${name}" gives the initials "${initials}"`, () => {
    expect(toAvatarInitials(name)).toBe(initials);
  });
}

for (const name of ["", "   ", "🌸 42 ---", undefined, null, 42]) {
  test(`${JSON.stringify(name) ?? "an absent name"} gives no initials`, () => {
    expect(toAvatarInitials(name)).toBeUndefined();
  });
}
