#!/usr/bin/env bash
set -e

echo "=== RENDER BUILD START ==="
node --version
npm --version

# Download pnpm via npx (avoids global install permission issues)
export PNPM_HOME="$HOME/.local/share/pnpm"
export PATH="$PNPM_HOME:$PATH"
npx --yes pnpm@9 --version

# Strip Replit-specific fields from pnpm-workspace.yaml that pnpm 9 doesn't recognize.
# These fields (minimumReleaseAge, minimumReleaseAgeExclude) are Replit-platform-only
# and will cause unknown-field errors on standard pnpm.
python3 - <<'PYEOF'
import re, shutil, sys

src = open("pnpm-workspace.yaml").read()

# Remove the big comment block + minimumReleaseAge field + minimumReleaseAgeExclude block
src = re.sub(
    r'# =+.*?# =+\n'      # banner comment
    r'minimumReleaseAge:.*?\n'
    r'\n?'
    r'minimumReleaseAgeExclude:[^\n]*\n'
    r'(?:  [^\n]*\n)*',    # indented list items
    '',
    src,
    flags=re.DOTALL
)

# Also strip any remaining minimumReleaseAge lines just in case
src = re.sub(r'^minimumReleaseAge.*\n', '', src, flags=re.MULTILINE)
src = re.sub(r'^minimumReleaseAgeExclude.*\n', '', src, flags=re.MULTILINE)

open("pnpm-workspace.yaml", "w").write(src)
print("pnpm-workspace.yaml cleaned successfully")
PYEOF

echo "=== Installing dependencies ==="
npx --yes pnpm@9 install --no-frozen-lockfile

echo "=== Building lib packages ==="
npx --yes pnpm@9 run typecheck:libs

echo "=== Building API server ==="
npx --yes pnpm@9 --filter @workspace/api-server run build

echo "=== BUILD COMPLETE ==="
ls -la artifacts/api-server/dist/
