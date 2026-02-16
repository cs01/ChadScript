#!/usr/bin/env bash
set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
RESET='\033[0m'

QUICK=false
TESTS_ONLY=false
SELF_HOSTING_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=true ;;
    --tests-only) TESTS_ONLY=true ;;
    --self-hosting-only) SELF_HOSTING_ONLY=true ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

step() { echo -e "\n${BOLD}==> $1${RESET}"; }
pass() { echo -e "${GREEN}    ✓ $1${RESET}"; }
fail() { echo -e "${RED}    ✗ $1${RESET}"; exit 1; }

step "Building TypeScript compiler"
npm run build --silent || fail "npm run build"
pass "tsc"

step "Stage 0: Building native compiler"
node dist/chadc-node.js src/chadc-native.ts -o .build/chadc || fail "stage 0 build"
pass "built .build/chadc"

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

.build/chadc examples/hello.ts -o "$TMPDIR/hello0" || fail "stage 0 compile hello"
OUTPUT=$("$TMPDIR/hello0" 2>&1)
[[ "$OUTPUT" == *"Hello from ChadScript"* ]] || fail "stage 0 smoke test"
pass "stage 0 smoke test"

TEST_PID=""
SH_PID=""
TEST_OK=true
SH_OK=true

if [[ "$SELF_HOSTING_ONLY" == "false" ]]; then
  step "Starting tests (background)"
  npm test > "$TMPDIR/test-output.log" 2>&1 &
  TEST_PID=$!
fi

if [[ "$TESTS_ONLY" == "false" ]]; then
  step "Self-hosting: Stage 1"
  .build/chadc src/chadc-native.ts -o "$TMPDIR/chad-stage1" || fail "stage 1 build"
  pass "built stage1"

  "$TMPDIR/chad-stage1" examples/hello.ts -o "$TMPDIR/hello1" || fail "stage 1 compile hello"
  OUTPUT=$("$TMPDIR/hello1" 2>&1)
  [[ "$OUTPUT" == *"Hello from ChadScript"* ]] || fail "stage 1 smoke test"
  pass "stage 1 smoke test"

  if [[ "$QUICK" == "false" ]]; then
    step "Self-hosting: Stage 2"
    "$TMPDIR/chad-stage1" src/chadc-native.ts -o "$TMPDIR/chad-stage2" || fail "stage 2 build"
    pass "built stage2"

    "$TMPDIR/chad-stage2" examples/hello.ts -o "$TMPDIR/hello2" || fail "stage 2 compile hello"
    OUTPUT=$("$TMPDIR/hello2" 2>&1)
    [[ "$OUTPUT" == *"Hello from ChadScript"* ]] || fail "stage 2 smoke test"
    pass "stage 2 smoke test"
  else
    echo -e "\n${BOLD}==> Skipping Stage 2 (--quick)${RESET}"
  fi
fi

if [[ -n "$TEST_PID" ]]; then
  step "Waiting for tests"
  if wait "$TEST_PID"; then
    pass "all tests passed"
  else
    TEST_OK=false
    echo -e "${RED}    ✗ tests failed${RESET}"
    echo -e "${YELLOW}--- test output ---${RESET}"
    cat "$TMPDIR/test-output.log"
    echo -e "${YELLOW}--- end test output ---${RESET}"
  fi
fi

echo ""
if [[ "$TEST_OK" == "true" && "$SH_OK" == "true" ]]; then
  echo -e "${GREEN}${BOLD}Verification PASSED${RESET}"
else
  echo -e "${RED}${BOLD}Verification FAILED${RESET}"
  exit 1
fi
