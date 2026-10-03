# Cloudflare Worker

## Commands

| Task            | Command                                                  |
| --------------- | -------------------------------------------------------- |
| Develop locally | `pnpm --filter '@cup/cloudflare-worker' run dev`         |
| Build           | `pnpm --filter '@cup/cloudflare-worker' run turbo:build` |
| Lint            | `pnpm --filter '@cup/cloudflare-worker' run turbo:lint`  |

- Deploy only when the user explicitly requests it.

## Cloudflare documentation

Before decisions about Cloudflare runtime behavior, configuration, compatibility, limits, quotas, or design, follow the [Cloudflare documentation guidance](../../docs/agents/cloudflare.md).
