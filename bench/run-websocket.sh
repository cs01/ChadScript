#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DURATION="${DURATION:-10}"
CLIENTS="${CLIENTS:-16}"
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
  WS_URL="ws://127.0.0.1:$port" DURATION=$DURATION CLIENTS=$CLIENTS node bench/websocket/client.mjs
  kill -9 "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  unset SERVER_PID
  sleep 0.5
}

echo "WebSocket Echo Benchmark"
echo "  duration: ${DURATION}s, clients: ${CLIENTS}"
echo ""

# --- ChadScript ---
PORT_CHAD=$(random_port)
CHAD_SRC_TEMPLATE="bench/websocket/chad-ws-server.ts"
CHAD_SRC="/tmp/chad-ws-bench-$$.ts"
CHAD_BINARY="/tmp/chad-ws-bench-$$"
sed "s/httpServe(3001,/httpServe($PORT_CHAD,/" "$CHAD_SRC_TEMPLATE" > "$CHAD_SRC"
BUILD_ARTIFACTS+=("$CHAD_SRC" "$CHAD_BINARY" "$CHAD_BINARY.ll")

echo "Compiling ChadScript WebSocket server..."
if [ -f ".build/chad" ]; then
  .build/chad build "$CHAD_SRC" -o "$CHAD_BINARY"
else
  npm run build --silent 2>/dev/null
  node dist/chad-node.js build "$CHAD_SRC" -o "$CHAD_BINARY"
fi

"$CHAD_BINARY" &
SERVER_PID=$!
run_bench "ChadScript (native)" "$PORT_CHAD"

# --- Node.js (requires ws package) ---
if node -e "require('ws')" 2>/dev/null; then
  PORT_NODE=$(random_port)
  PORT=$PORT_NODE node bench/websocket/node-ws-server.mjs &
  SERVER_PID=$!
  run_bench "Node.js (ws)" "$PORT_NODE"
else
  echo ""
  echo "=== Node.js ==="
  echo "  (skipped: 'ws' package not installed — npm install ws)"
fi

# --- Bun ---
if command -v bun &> /dev/null; then
  PORT_BUN=$(random_port)
  PORT=$PORT_BUN bun bench/websocket/bun-ws-server.js &
  SERVER_PID=$!
  run_bench "Bun" "$PORT_BUN"
else
  echo ""
  echo "=== Bun ==="
  echo "  (skipped: bun not found in PATH)"
fi

echo ""
echo "=== Done ==="
