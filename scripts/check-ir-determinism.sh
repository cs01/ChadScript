#!/usr/bin/env bash
# Investigative tool: compile a ChadScript file to LLVM IR twice in
# independent processes, diff the outputs. Any difference = latent
# non-determinism in codegen (Map iteration order, Set ordering, unstable
# sort, unseeded PRNG, etc.) — each is a real correctness bug class that
# can produce arch-divergent IR under -O2 optimization.
#
# NOT a CI gate yet. Once known sources are fixed, this becomes a CI gate.
#
# Usage: bash scripts/check-ir-determinism.sh [path/to/file.ts]
# Default: src/chad-native.ts (the self-hosting oracle).
#
# NOTE: `chad ir` currently writes to .build/src/<name>.ll regardless of -o
# (CLI bug — file a separate issue). We snapshot that path.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-$ROOT/src/chad-native.ts}"
CHAD="node $ROOT/dist/chad-node.js"

if [ ! -f "$ROOT/dist/chad-node.js" ]; then
  echo "ERROR: $ROOT/dist/chad-node.js not found. Run 'npm run build' first." >&2
  exit 2
fi

BASENAME=$(basename "$TARGET" .ts)
IR_PATH="$ROOT/.build/src/${BASENAME}.ll"

A=$(mktemp)
B=$(mktemp)
trap 'rm -f "$A" "$B"' EXIT

echo "==> Compiling $TARGET to IR (run 1/2)"
$CHAD ir "$TARGET" > /dev/null
cp "$IR_PATH" "$A"
echo "==> Compiling $TARGET to IR (run 2/2)"
$CHAD ir "$TARGET" > /dev/null
cp "$IR_PATH" "$B"

SIZE_A=$(wc -c < "$A")
SIZE_B=$(wc -c < "$B")

if cmp -s "$A" "$B"; then
  echo "==> IR is deterministic (${SIZE_A} bytes)"
  exit 0
fi

echo "==> IR is NON-DETERMINISTIC — investigate" >&2
echo "    run1: ${SIZE_A} bytes  run2: ${SIZE_B} bytes" >&2
echo "    diff line count: $(diff "$A" "$B" | grep -c '^[<>]' || true)" >&2
echo "" >&2
echo "--- first 60 differing lines ---" >&2
diff "$A" "$B" | head -60 >&2
exit 1
