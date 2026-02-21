#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DURATION="${DURATION:-10}"
CONCURRENCY="${CONCURRENCY:-50}"
BUILD_ARTIFACTS=()

cd "$PROJECT_DIR"

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill -9 "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  for f in "${BUILD_ARTIFACTS[@]}"; do
    rm -f "$f"
  done
}
trap cleanup EXIT

random_port() {
  shuf -i 10000-60000 -n 1
}

wait_for_server() {
  local port=$1
  local max_attempts=50
  for i in $(seq 1 $max_attempts); do
    if curl -s "http://127.0.0.1:$port/" > /dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  echo "ERROR: server did not start on port $port"
  return 1
}

run_bench() {
  local label="$1"
  local port="$2"
  echo ""
  echo "=== $label ==="
  wait_for_server "$port"
  PORT=$port DURATION=$DURATION CONCURRENCY=$CONCURRENCY node bench/http/client.mjs
  kill -9 "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  unset SERVER_PID
  sleep 0.5
}

echo "HTTP Server Benchmark"
echo "  duration: ${DURATION}s, concurrency: ${CONCURRENCY}"
echo ""

# --- ChadScript ---
PORT_CHAD=$(random_port)
CHAD_SRC_TEMPLATE="bench/http/chad-server.ts"
CHAD_SRC="/tmp/chad-http-bench-$$.ts"
CHAD_BINARY="/tmp/chad-http-bench-$$"
sed "s/httpServe(3000,/httpServe($PORT_CHAD,/" "$CHAD_SRC_TEMPLATE" > "$CHAD_SRC"
BUILD_ARTIFACTS+=("$CHAD_SRC" "$CHAD_BINARY" "$CHAD_BINARY.ll")

echo "Compiling ChadScript server..."
if [ -f ".build/chad" ]; then
  .build/chad build "$CHAD_SRC" -o "$CHAD_BINARY"
else
  npm run build --silent 2>/dev/null
  node dist/chad-node.js build "$CHAD_SRC" -o "$CHAD_BINARY"
fi

"$CHAD_BINARY" &
SERVER_PID=$!
run_bench "ChadScript (native)" "$PORT_CHAD"

# --- C ---
PORT_C=$(random_port)
C_BINARY="/tmp/c-http-bench-$$"
BUILD_ARTIFACTS+=("$C_BINARY")
echo "Compiling C server..."
gcc -O2 -o "$C_BINARY" bench/http/c-server.c
PORT=$PORT_C "$C_BINARY" &
SERVER_PID=$!
run_bench "C" "$PORT_C"

# --- Go ---
if command -v go &> /dev/null; then
  PORT_GO=$(random_port)
  GO_BINARY="/tmp/go-http-bench-$$"
  BUILD_ARTIFACTS+=("$GO_BINARY")
  echo "Compiling Go server..."
  go build -o "$GO_BINARY" bench/http/go-server.go
  PORT=$PORT_GO "$GO_BINARY" &
  SERVER_PID=$!
  run_bench "Go" "$PORT_GO"
else
  echo ""
  echo "=== Go ==="
  echo "  (skipped: go not found in PATH)"
fi

# --- Node.js ---
PORT_NODE=$(random_port)
PORT=$PORT_NODE node bench/http/node-server.mjs &
SERVER_PID=$!
run_bench "Node.js" "$PORT_NODE"

# --- Bun ---
if command -v bun &> /dev/null; then
  PORT_BUN=$(random_port)
  PORT=$PORT_BUN bun bench/http/bun-server.js &
  SERVER_PID=$!
  run_bench "Bun" "$PORT_BUN"
else
  echo ""
  echo "=== Bun ==="
  echo "  (skipped: bun not found in PATH)"
fi

echo ""
echo "=== Done ==="
