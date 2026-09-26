#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
echo ">>> Vector Core deploy started $(date -u)"

git fetch origin
git reset --hard origin/main

cd backend
pnpm install --frozen-lockfile
pnpm run build

cd ..
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

echo ">>> Vector Core deploy finished $(date -u)"
