#!/usr/bin/env bash
# Run all compilable examples and verify they work.
# Server examples are started, verified with curl, then killed.
# Usage: bash scripts/run-examples.sh [--compiler <path>]

set -euo pipefail

COMPILER="${COMPILER:-.build/chad}"
BUILD_DIR="/tmp/chadscript-examples"
PASSED=0
FAILED=0
FAILURES=""

# Parse --compiler flag
while [[ $# -gt 0 ]]; do
  case "$1" in
    --compiler) COMPILER="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Validate compiler exists — supports both a binary path and "node dist/chad-node.js"
COMPILER_FIRST_WORD="${COMPILER%% *}"
if [ ! -f "$COMPILER_FIRST_WORD" ] && ! command -v "$COMPILER_FIRST_WORD" &>/dev/null; then
  echo "Compiler not found: $COMPILER"
  echo "Build it first: node dist/chad-node.js build src/chad-native.ts -o .build/chad"
  exit 1
fi

mkdir -p "$BUILD_DIR"

# --- Helpers ---

pass() {
  echo "  PASS: $1"
  PASSED=$((PASSED + 1))
}

fail() {
  echo "  FAIL: $1 — $2"
  FAILED=$((FAILED + 1))
  FAILURES="${FAILURES}\n  $1: $2"
}

compile() {
  local src="$1"
  local out="$2"
  # Use eval-free word splitting so "node dist/chad-node.js" works
  if ! $COMPILER build "$src" -o "$out" 2>&1; then
    return 1
  fi
  return 0
}


# Wait for a server to respond on a port (up to N seconds)
wait_for_server() {
  local port="$1"
  local max_wait="${2:-5}"
  local i=0
  while [ $i -lt $max_wait ]; do
    if curl -s -o /dev/null -w '' "http://localhost:$port/" 2>/dev/null; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}

echo "=== ChadScript Examples Runner ==="
echo "Compiler: $COMPILER"
echo "Build dir: $BUILD_DIR"
echo ""

# --- 1. hello.ts (simple print) ---

echo "[1/15] hello.ts"
if compile examples/snippets/hello.ts "$BUILD_DIR/hello"; then
  OUTPUT=$("$BUILD_DIR/hello" 2>&1) || true
  if echo "$OUTPUT" | grep -q "Hello from ChadScript"; then
    pass "hello.ts"
  else
    fail "hello.ts" "unexpected output: $OUTPUT"
  fi
else
  fail "hello.ts" "compile failed"
fi

# --- 2. timers.ts (event loop, self-terminating) ---

echo "[2/15] timers.ts"
if compile examples/snippets/timers.ts "$BUILD_DIR/timers"; then
  # No `timeout` on macOS — use background process + wait with a deadline
  "$BUILD_DIR/timers" > "$BUILD_DIR/timers.out" 2>&1 &
  TIMER_PID=$!
  ( sleep 10; kill "$TIMER_PID" 2>/dev/null ) &
  WATCHDOG_PID=$!
  wait "$TIMER_PID" 2>/dev/null || true
  kill "$WATCHDOG_PID" 2>/dev/null || true
  wait "$WATCHDOG_PID" 2>/dev/null || true
  OUTPUT=$(cat "$BUILD_DIR/timers.out")
  if echo "$OUTPUT" | grep -q "tick 3"; then
    pass "timers.ts"
  else
    fail "timers.ts" "didn't see tick 3: $OUTPUT"
  fi
else
  fail "timers.ts" "compile failed"
fi

# --- 3. sqlite-demo.ts (sqlite in-memory) ---

echo "[3/15] sqlite-demo.ts"
if compile examples/snippets/sqlite-demo.ts "$BUILD_DIR/query"; then
  OUTPUT=$("$BUILD_DIR/query" 2>&1) || true
  if echo "$OUTPUT" | grep -q "Alice"; then
    pass "sqlite-demo.ts"
  else
    fail "sqlite-demo.ts" "unexpected output: $OUTPUT"
  fi
else
  fail "sqlite-demo.ts" "compile failed"
fi

# --- 4. cwc.ts (file I/O + argparse) ---

echo "[4/15] cwc.ts"
if compile examples/cli-tools/cwc.ts "$BUILD_DIR/cwc"; then
  # Create a test file to count
  echo "hello world foo bar" > "$BUILD_DIR/test-input.txt"
  OUTPUT=$("$BUILD_DIR/cwc" "$BUILD_DIR/test-input.txt" 2>&1) || true
  if echo "$OUTPUT" | grep -q "4"; then
    pass "cwc.ts"
  else
    fail "cwc.ts" "unexpected output: $OUTPUT"
  fi
else
  fail "cwc.ts" "compile failed"
fi

# --- 5. cgrep.ts (grep-like) ---

echo "[5/15] cgrep.ts"
if compile examples/cli-tools/cgrep.ts "$BUILD_DIR/cgrep"; then
  # Create a test file to search
  printf "line one\nfind me here\nline three\n" > "$BUILD_DIR/search-input.txt"
  OUTPUT=$("$BUILD_DIR/cgrep" "find" "$BUILD_DIR/search-input.txt" 2>&1) || true
  if echo "$OUTPUT" | grep -q "find"; then
    pass "cgrep.ts"
  else
    fail "cgrep.ts" "unexpected output: $OUTPUT"
  fi
else
  fail "cgrep.ts" "compile failed"
fi

# --- 6. http-server (server + curl) ---

echo "[6/15] http-server"
if compile examples/apps/http-server/app.ts "$BUILD_DIR/http-server"; then
  PORT=18080
  "$BUILD_DIR/http-server" -p "$PORT" &
  SERVER_PID=$!

  if wait_for_server "$PORT" 5; then
    # Test root endpoint
    RESP=$(curl -s "http://localhost:$PORT/")
    if echo "$RESP" | grep -q "ChadScript"; then
      # Test JSON endpoint
      RESP2=$(curl -s "http://localhost:$PORT/json")
      if echo "$RESP2" | grep -q "message"; then
        # Test POST echo
        RESP3=$(curl -s -X POST -d 'hello world' "http://localhost:$PORT/echo")
        if echo "$RESP3" | grep -q "hello world"; then
          pass "http-server"
        else
          fail "http-server" "POST /echo failed: $RESP3"
        fi
      else
        fail "http-server" "GET /json failed: $RESP2"
      fi
    else
      fail "http-server" "GET / failed: $RESP"
    fi
  else
    fail "http-server" "server didn't start on port $PORT"
  fi

  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
else
  fail "http-server" "compile failed"
fi

# --- 7. hackernews/app.ts (full-stack server + curl) ---

echo "[7/15] hackernews/app.ts"
if compile examples/apps/hackernews/app.ts "$BUILD_DIR/hackernews"; then
  PORT=18081
  "$BUILD_DIR/hackernews" -p "$PORT" &
  SERVER_PID=$!

  if wait_for_server "$PORT" 5; then
    # Test API endpoint
    RESP=$(curl -s "http://localhost:$PORT/api/posts")
    if echo "$RESP" | grep -q "ChadScript"; then
      # Test HTML page
      RESP2=$(curl -s "http://localhost:$PORT/")
      if echo "$RESP2" | grep -q "html"; then
        pass "hackernews/app.ts"
      else
        fail "hackernews/app.ts" "GET / didn't return HTML: ${RESP2:0:100}"
      fi
    else
      fail "hackernews/app.ts" "GET /api/posts failed: ${RESP:0:100}"
    fi
  else
    fail "hackernews/app.ts" "server didn't start on port $PORT"
  fi

  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
else
  fail "hackernews/app.ts" "compile failed"
fi

# --- 8. parallel.ts (parallel HTTP fetches with Promise.all) ---

echo "[8/15] parallel.ts"
if compile examples/snippets/parallel.ts "$BUILD_DIR/parallel"; then
  "$BUILD_DIR/parallel" > "$BUILD_DIR/parallel.out" 2>&1 &
  PARALLEL_PID=$!
  ( sleep 30; kill "$PARALLEL_PID" 2>/dev/null ) &
  WATCHDOG_PID=$!
  wait "$PARALLEL_PID" 2>/dev/null || true
  kill "$WATCHDOG_PID" 2>/dev/null || true
  wait "$WATCHDOG_PID" 2>/dev/null || true
  OUTPUT=$(cat "$BUILD_DIR/parallel.out")
  if echo "$OUTPUT" | grep -q "stars"; then
    pass "parallel.ts"
  else
    fail "parallel.ts" "unexpected output: $OUTPUT"
  fi
else
  fail "parallel.ts" "compile failed"
fi

# --- 9. cjq.ts (JSON query tool) ---

echo "[9/15] cjq.ts"
if compile examples/cli-tools/cjq.ts "$BUILD_DIR/cjq"; then
  # Create a test JSON file
  printf '{"name":"test","values":[1,2,3]}\n' > "$BUILD_DIR/test.json"
  OUTPUT=$("$BUILD_DIR/cjq" ".name" "$BUILD_DIR/test.json" 2>&1) || true
  if echo "$OUTPUT" | grep -q "test"; then
    pass "cjq.ts"
  else
    fail "cjq.ts" "unexpected output: $OUTPUT"
  fi
else
  fail "cjq.ts" "compile failed"
fi

# --- 10. ccat.ts (file viewer with syntax highlighting) ---

echo "[10/15] ccat.ts"
if compile examples/cli-tools/ccat.ts "$BUILD_DIR/ccat"; then
  OUTPUT=$("$BUILD_DIR/ccat" --plain examples/cli-tools/ccat.ts 2>&1) || true
  if echo "$OUTPUT" | grep -q "ArgumentParser"; then
    pass "ccat.ts"
  else
    fail "ccat.ts" "unexpected output: ${OUTPUT:0:200}"
  fi
else
  fail "ccat.ts" "compile failed"
fi

# --- 11. chex.ts (hex dump viewer) ---

echo "[11/15] chex.ts"
if compile examples/cli-tools/chex.ts "$BUILD_DIR/chex"; then
  printf 'Hello ChadScript\n' > "$BUILD_DIR/hex-input.txt"
  OUTPUT=$("$BUILD_DIR/chex" -C "$BUILD_DIR/hex-input.txt" 2>&1) || true
  if echo "$OUTPUT" | grep -q "48 65 6c 6c 6f"; then
    pass "chex.ts"
  else
    fail "chex.ts" "unexpected output: ${OUTPUT:0:200}"
  fi
else
  fail "chex.ts" "compile failed"
fi

# --- 12. ctree.ts (directory tree) ---

echo "[12/15] ctree.ts"
if compile examples/cli-tools/ctree.ts "$BUILD_DIR/ctree"; then
  OUTPUT=$("$BUILD_DIR/ctree" -C -L 1 examples/cli-tools 2>&1) || true
  if echo "$OUTPUT" | grep -q "director"; then
    pass "ctree.ts"
  else
    fail "ctree.ts" "unexpected output: ${OUTPUT:0:200}"
  fi
else
  fail "ctree.ts" "compile failed"
fi

# --- 13. cql.ts (SQL on CSV) ---

echo "[13/15] cql.ts"
if compile examples/cli-tools/cql.ts "$BUILD_DIR/cql"; then
  printf 'name,age\nAlice,30\nBob,25\n' > "$BUILD_DIR/test.csv"
  OUTPUT=$("$BUILD_DIR/cql" "SELECT * FROM data" "$BUILD_DIR/test.csv" 2>&1) || true
  if echo "$OUTPUT" | grep -q "Alice"; then
    pass "cql.ts"
  else
    fail "cql.ts" "unexpected output: ${OUTPUT:0:200}"
  fi
else
  fail "cql.ts" "compile failed"
fi

# --- 14. chttp.ts (HTTP client, compile-only — needs network) ---

echo "[14/15] chttp.ts"
if compile examples/cli-tools/chttp.ts "$BUILD_DIR/chttp"; then
  pass "chttp.ts"
else
  fail "chttp.ts" "compile failed"
fi

# --- 15. cserve.ts (static file server, compile-only) ---

echo "[15/15] cserve.ts"
if compile examples/cli-tools/cserve.ts "$BUILD_DIR/cserve"; then
  pass "cserve.ts"
else
  fail "cserve.ts" "compile failed"
fi

# --- Summary ---

echo ""
echo "=== Results ==="
TOTAL=$((PASSED + FAILED))
echo "Passed: $PASSED / $TOTAL"
echo "Failed: $FAILED / $TOTAL"

if [ $FAILED -gt 0 ]; then
  echo -e "\nFailures:$FAILURES"
  exit 1
fi

echo ""
echo "All examples passed!"
