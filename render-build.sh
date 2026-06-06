#!/usr/bin/env bash
set -e
echo "NODE: $(node --version)"
echo "NPM: $(npm --version)"
echo "Testing pnpm install..."
npx --yes pnpm@9 install --no-frozen-lockfile
echo "=== INSTALL OK ==="
npx --yes pnpm@9 run typecheck:libs
echo "=== LIBS OK ==="
npx --yes pnpm@9 --filter @workspace/api-server run build
echo "=== BUILD OK ==="
ls -la artifacts/api-server/dist/

