#!/bin/sh
set -e

# Run from the session's checkout; in a worktree session this differs from the project directory.
checkout_dir="$(git rev-parse --show-toplevel)"
cd "${checkout_dir}"

if [ -f node_modules/.modules.yaml ] &&
    [ -f apps/cloudflare-worker/.env.local ] &&
    [ -f libs/narration-content-selection/.env.evals ]; then
    exit 0
fi

echo "Bootstrapping ${checkout_dir}." >&2
git submodule update --init --recursive >&2
pnpm install >&2
