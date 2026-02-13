#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$DIR")"
CHAD="$REPO/.build/chadc"
STARTUP_RUNS=50
HTTP_BENCH="$DIR/tools/httpbench"
WS_BENCH="$DIR/tools/wsbench"
HTTP_PORT=9876
WS_PORT=9877
BENCH_DURATION=10s

echo "╔══════════════════════════════════════════════════╗"
echo "║          ChadScript Benchmark Suite              ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

echo "--- Building ---"

$CHAD "$DIR/startup/chadscript.ts" -o /tmp/bench-startup-chad
echo "  ChadScript startup built"

$CHAD "$DIR/sqlite/chadscript.ts" -o /tmp/bench-sqlite-chad
echo "  ChadScript SQLite built"

$CHAD "$DIR/matmul/chadscript.ts" -o /tmp/bench-matmul-chad
echo "  ChadScript Matmul built"

$CHAD "$DIR/montecarlo/chadscript.ts" -o /tmp/bench-montecarlo-chad
echo "  ChadScript Monte Carlo built"

$CHAD "$DIR/http/chadscript.ts" -o /tmp/bench-http-chad
echo "  ChadScript HTTP server built"

$CHAD "$DIR/websocket/chadscript.ts" -o /tmp/bench-ws-chad
echo "  ChadScript WebSocket server built"

clang -O2 -o /tmp/bench-startup-c "$DIR/startup/hello.c"
echo "  C startup built"

clang -O2 -o /tmp/bench-sqlite-c "$DIR/sqlite/bench.c" -lsqlite3
echo "  C SQLite built"

clang -O2 -o /tmp/bench-matmul-c "$DIR/matmul/bench.c"
echo "  C Matmul built"

clang -O2 -o /tmp/bench-montecarlo-c "$DIR/montecarlo/bench.c"
echo "  C Monte Carlo built"

go build -o /tmp/bench-startup-go "$DIR/startup/hello.go"
echo "  Go startup built"

go build -o /tmp/bench-matmul-go "$DIR/matmul/matmul.go"
echo "  Go Matmul built"

go build -o /tmp/bench-montecarlo-go "$DIR/montecarlo/montecarlo.go"
echo "  Go Monte Carlo built"

go build -o /tmp/bench-http-go "$DIR/http/go_server.go"
echo "  Go HTTP server built"

go build -o /tmp/bench-ws-go "$DIR/websocket/go_server.go"
echo "  Go WebSocket server built"

echo ""

bench_startup() {
    local name="$1"
    shift
    local start_ns=$(date +%s%N)
    for i in $(seq 1 $STARTUP_RUNS); do
        "$@" > /dev/null 2>&1
    done
    local end_ns=$(date +%s%N)
    local avg_us=$(( (end_ns - start_ns) / STARTUP_RUNS / 1000 ))
    local avg_ms_int=$(( avg_us / 1000 ))
    local avg_ms_frac=$(( (avg_us % 1000) / 100 ))
    printf "    %-20s %d.%dms\n" "$name" "$avg_ms_int" "$avg_ms_frac"
}

wait_port_free() {
    local port=$1
    for i in $(seq 1 30); do
        if ! ss -tln 2>/dev/null | grep -q ":${port} "; then
            return 0
        fi
        sleep 0.2
    done
}

bench_http_server() {
    local name="$1"
    shift
    wait_port_free $HTTP_PORT
    "$@" > /dev/null 2>&1 &
    local pid=$!
    sleep 1
    echo "  $name"
    $HTTP_BENCH -url "http://127.0.0.1:${HTTP_PORT}/" -c 100 -d "$BENCH_DURATION" 2>&1 | sed 's/^/    /'
    kill -9 $pid 2>/dev/null
    wait $pid 2>/dev/null
    sleep 0.5
    echo ""
}

bench_ws_server() {
    local name="$1"
    shift
    wait_port_free $WS_PORT
    "$@" > /dev/null 2>&1 &
    local pid=$!
    sleep 1
    echo "  $name"
    $WS_BENCH -url "ws://127.0.0.1:${WS_PORT}/" -c 32 -d "$BENCH_DURATION" 2>&1 | sed 's/^/    /'
    kill -9 $pid 2>/dev/null
    wait $pid 2>/dev/null
    sleep 0.5
    echo ""
}

echo "═══════════════════════════════════════════════════"
echo "  Cold Start  (avg of ${STARTUP_RUNS} runs)"
echo "═══════════════════════════════════════════════════"
echo ""

bench_startup "C (clang -O2)" /tmp/bench-startup-c
bench_startup "ChadScript" /tmp/bench-startup-chad
bench_startup "Go" /tmp/bench-startup-go
bench_startup "Bun" bun "$DIR/startup/bun.mjs"
bench_startup "Node.js" node "$DIR/startup/node.mjs"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  SQLite  (100 rows, 100K queries, in-memory)"
echo "═══════════════════════════════════════════════════"
echo ""

echo "  C (clang -O2)"
/tmp/bench-sqlite-c 2>&1 | sed 's/^/    /'
echo ""

echo "  ChadScript (native)"
/tmp/bench-sqlite-chad 2>&1 | sed 's/^/    /'
echo ""

echo "  Node.js $(node --version)"
node --experimental-sqlite "$DIR/sqlite/node.mjs" 2>&1 | grep -v -i experimental | grep -v trace-warnings | sed 's/^/    /'
echo ""

echo "  Bun $(bun --version)"
bun "$DIR/sqlite/bun.mjs" 2>&1 | sed 's/^/    /'
echo ""

echo "═══════════════════════════════════════════════════"
echo "  Matrix Multiply  (512x512, double precision)"
echo "═══════════════════════════════════════════════════"
echo ""

echo "  C (clang -O2)"
/tmp/bench-matmul-c 2>&1 | sed 's/^/    /'
echo ""

echo "  ChadScript (native)"
/tmp/bench-matmul-chad 2>&1 | sed 's/^/    /'
echo ""

echo "  Go"
/tmp/bench-matmul-go 2>&1 | sed 's/^/    /'
echo ""

echo "  Node.js $(node --version)"
node "$DIR/matmul/node.mjs" 2>&1 | sed 's/^/    /'
echo ""

echo "  Bun $(bun --version)"
bun "$DIR/matmul/bun.mjs" 2>&1 | sed 's/^/    /'
echo ""

echo "═══════════════════════════════════════════════════"
echo "  Monte Carlo Pi  (100M samples, deterministic LCG)"
echo "═══════════════════════════════════════════════════"
echo ""

echo "  C (clang -O2)"
/tmp/bench-montecarlo-c 2>&1 | sed 's/^/    /'
echo ""

echo "  ChadScript (native)"
/tmp/bench-montecarlo-chad 2>&1 | sed 's/^/    /'
echo ""

echo "  Go"
/tmp/bench-montecarlo-go 2>&1 | sed 's/^/    /'
echo ""

echo "  Node.js $(node --version)"
node "$DIR/montecarlo/node.mjs" 2>&1 | sed 's/^/    /'
echo ""

echo "  Bun $(bun --version)"
bun "$DIR/montecarlo/bun.mjs" 2>&1 | sed 's/^/    /'
echo ""

echo "═══════════════════════════════════════════════════"
echo "  HTTP Server  (hello world, 100 concurrent, ${BENCH_DURATION})"
echo "═══════════════════════════════════════════════════"
echo ""

bench_http_server "ChadScript (native)" /tmp/bench-http-chad
bench_http_server "Go (net/http)" /tmp/bench-http-go
bench_http_server "Bun $(bun --version)" bun "$DIR/http/bun.mjs"
bench_http_server "Node.js $(node --version)" node "$DIR/http/node.mjs"

echo "═══════════════════════════════════════════════════"
echo "  WebSocket  (echo, 32 clients, ${BENCH_DURATION})"
echo "═══════════════════════════════════════════════════"
echo ""

bench_ws_server "ChadScript (native)" /tmp/bench-ws-chad
bench_ws_server "Go (x/net/websocket)" /tmp/bench-ws-go
bench_ws_server "Bun $(bun --version)" bun "$DIR/websocket/bun.mjs"
bench_ws_server "Node.js $(node --version)" node "$DIR/websocket/node.mjs"

echo "═══════════════════════════════════════════════════"
echo "  Done"
echo "═══════════════════════════════════════════════════"
