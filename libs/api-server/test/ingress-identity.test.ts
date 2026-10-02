import { expect, test } from "vitest";

import { ingressIdentity, normalizeIp } from "#src/ingress-identity.ts";

test("canonicalizes IPv6 variants and IPv4-mapped addresses into one rate bucket", () => {
  expect(normalizeIp("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe(normalizeIp("2001:db8::1"));
  expect(normalizeIp("::ffff:192.0.2.1")).toBe(normalizeIp("192.0.2.1"));
  expect(normalizeIp("999.0.0.1")).toBeUndefined();
  expect(normalizeIp("192.0.2.1, 192.0.2.2")).toBeUndefined();
});

test("ignores spoofed forwarding headers outside trusted Cloudflare metadata", async () => {
  const request = new Request("https://cup-audio.com/api/account", {
    headers: { "CF-Connecting-IP": "192.0.2.1", "X-Forwarded-For": "192.0.2.1" },
  });
  expect(await ingressIdentity(request)).toBeUndefined();
  expect(await ingressIdentity(request, true)).toBeUndefined();
  const local = await ingressIdentity(new Request("http://localhost:5173/api/account"), true);
  expect(local).toMatch(/^[a-f0-9]{64}$/);
});
