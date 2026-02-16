#!/usr/bin/env bash
set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
RESET='\033[0m'

QUICK=false
if [[ "${1:-}" == "--quick" ]]; then
  QUICK=true
fi

step() { echo -e "\n${BOLD}==> $1${RESET}"; }
pass() { echo -e "${GREEN}    ✓ $1${RESET}"; }
fail() { echo -e "${RED}    ✗ $1${RESET}"; exit 1; }

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

step "Building TypeScript compiler"
npm run build --silent || fail "npm run build"
pass "tsc"

step "Stage 0: Node.js builds native compiler"
node dist/chadc-node.js src/chadc-native.ts -o .build/chadc || fail "stage 0 build"
pass "built .build/chadc"

.build/chadc examples/hello.ts -o "$TMPDIR/hello0" || fail "stage 0 compile hello"
OUTPUT=$("$TMPDIR/hello0" 2>&1)
[[ "$OUTPUT" == *"Hello from ChadScript"* ]] || fail "stage 0 smoke test"
pass "smoke test"

step "Stage 1: Native compiler compiles itself"
.build/chadc src/chadc-native.ts -o "$TMPDIR/chad-stage1" || fail "stage 1 build"
pass "built stage1"

"$TMPDIR/chad-stage1" examples/hello.ts -o "$TMPDIR/hello1" || fail "stage 1 compile hello"
OUTPUT=$("$TMPDIR/hello1" 2>&1)
[[ "$OUTPUT" == *"Hello from ChadScript"* ]] || fail "stage 1 smoke test"
pass "smoke test"

if [[ "$QUICK" == "false" ]]; then
step "Stage 2: Stage 1 compiles itself"
"$TMPDIR/chad-stage1" src/chadc-native.ts -o "$TMPDIR/chad-stage2" || fail "stage 2 build"
pass "built stage2"

"$TMPDIR/chad-stage2" examples/hello.ts -o "$TMPDIR/hello2" || fail "stage 2 compile hello"
OUTPUT=$("$TMPDIR/hello2" 2>&1)
[[ "$OUTPUT" == *"Hello from ChadScript"* ]] || fail "stage 2 smoke test"
pass "smoke test"
else
echo -e "\n${BOLD}==> Skipping Stage 2 (--quick)${RESET}"
fi

echo -e "\n${GREEN}${BOLD}Self-hosting chain PASSED${RESET}"
