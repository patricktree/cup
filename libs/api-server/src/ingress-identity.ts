/** Never accept caller-supplied forwarding headers as an ingress identity. */
export async function ingressIdentity(request: Request, localDevelopment = false) {
  const value =
    (request.cf ? request.headers.get("CF-Connecting-IP") : null) ??
    (localDevelopment && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname)
      ? "127.0.0.1"
      : null);
  if (!value) return undefined;
  const normalized = normalizeIp(value);
  if (!normalized) return undefined;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function normalizeIp(value: string): string | undefined {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    const octets = value.split(".").map(Number);
    return octets.every((octet) => octet <= 255) ? octets.join(".") : undefined;
  }
  if (!/^[a-f0-9:.]+$/i.test(value) || !value.includes(":")) return undefined;
  try {
    const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(normalized);
    if (mapped) {
      const high = parseInt(mapped[1]!, 16),
        low = parseInt(mapped[2]!, 16);
      return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
    }
    return normalized;
  } catch {
    return undefined;
  }
}
