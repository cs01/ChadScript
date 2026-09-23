#!/bin/sh
# Fetch the pinned Milo compiler into .milo/ (gitignored). The runtime is written in Milo and the
# driver compiles it with `.milo/milo` unless CHAD_MILO names another `milo` wrapper (a local
# checkout, for working on Milo itself). Idempotent: a checkout already at the pin is left alone.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$root/scripts/milo-pin.sh"
dir="$root/.milo"
if [ -d "$dir/.git" ] && [ "$(git -C "$dir" rev-parse HEAD)" = "$MILO_COMMIT" ]; then
  echo "milo: $dir already at $MILO_COMMIT"
  exit 0
fi
rm -rf "$dir"
git init -q "$dir"
git -C "$dir" remote add origin "$MILO_REPO"
# Shallow fetch of exactly the pinned commit: the compiler is bun-run TypeScript plus std/, so
# no history and no build step are needed.
git -C "$dir" fetch -q --depth 1 origin "$MILO_COMMIT"
git -C "$dir" checkout -q FETCH_HEAD
echo "milo: fetched $MILO_COMMIT into $dir"
