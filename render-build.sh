#!/usr/bin/env bash
set -e
echo "NODE: $(node --version)"
echo "NPM:  $(npm --version)"
npx --yes pnpm@latest --version
echo "=== Installing dependencies ==="
npx --yes pnpm@latest install --no-frozen-lockfile
echo "=== Building lib packages ==="
npx --yes pnpm@latest run typecheck:libs
echo "=== Building API server ==="
npx --yes pnpm@latest --filter @workspace/api-server run build
echo "=== BUILD COMPLETE ==="
ls -la artifacts/api-server/dist/

