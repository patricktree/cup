#!/bin/sh
set -e

cd "$(dirname "$0")"

# a linked worktree starts without the ignored environment files; create them from the main checkout
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git_dir="$(git rev-parse --path-format=absolute --git-dir)"
    git_common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
    env_source="$(dirname "${git_common_dir}")/apps/cloudflare-worker/.env.local"
    if [ "${git_dir}" != "${git_common_dir}" ] && [ -f "${env_source}" ]; then
        if [ ! -f apps/cloudflare-worker/.env.local ] || [ ! -f libs/narration-source-analysis/.env.evals ] || [ ! -f libs/audiobook-production/.env.evals ]; then
            node tooling/env-setup/src/cli.ts setup --from "${env_source}"
        fi
    fi
fi

# a checkout from before the narration-source-analysis rename keeps .env.evals at the old library path; setup moves it
if [ -f libs/narration-content-selection/.env.evals ] && [ ! -f libs/narration-source-analysis/.env.evals ]; then
    node tooling/env-setup/src/cli.ts setup --from apps/cloudflare-worker/.env.local
fi

# a checkout from before the speech recognition evals has no libs/audiobook-production/.env.evals; setup creates it from the Worker's file
if [ -f apps/cloudflare-worker/.env.local ] && [ ! -f libs/audiobook-production/.env.evals ]; then
    node tooling/env-setup/src/cli.ts setup --from apps/cloudflare-worker/.env.local
fi

pnpm run env:check

# Worker types are not committed; generate them so typechecking, lint, and tests work before a build
pnpm run cf-typegen

if [ "${CI}" = "true" ]; then
    # in CI/CD (i.e. GitHub Actions runners and Docker builds), we are finished
    exit 0
else
    # on developer machines, run some commands

    # install husky git hooks
    husky
fi
