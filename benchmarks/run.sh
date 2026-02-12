#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$DIR")"
CHAD="$REPO/.build/chadc"
STARTUP_RUNS=50

echo "╔══════════════════════════════════════════════════╗"
echo "║          ChadScript Benchmark Suite              ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

echo "--- Building ---"

$CHAD "$DIR/startup/chadscript.ts" -o /tmp/bench-startup-chad
echo "  ChadScript startup built"

$CHAD "$DIR/fibonacci/chadscript.ts" -o /tmp/bench-fib-chad
echo "  ChadScript fibonacci built"

$CHAD "$DIR/sqlite/chadscript.ts" -o /tmp/bench-sqlite-chad
echo "  ChadScript SQLite built"

go build -o /tmp/bench-startup-go "$DIR/startup/hello.go"
echo "  Go startup built"

go build -o /tmp/bench-fib-go "$DIR/fibonacci/fib.go"
echo "  Go fibonacci built"

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

echo "═══════════════════════════════════════════════════"
echo "  Cold Start  (avg of ${STARTUP_RUNS} runs)"
echo "═══════════════════════════════════════════════════"
echo ""

bench_startup "ChadScript" /tmp/bench-startup-chad
bench_startup "Go" /tmp/bench-startup-go
bench_startup "Bun" bun "$DIR/startup/bun.mjs"
bench_startup "Node.js" node "$DIR/startup/node.mjs"
bench_startup "Python" python3 "$DIR/startup/hello.py"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Fibonacci(42) — recursive CPU benchmark"
echo "═══════════════════════════════════════════════════"
echo ""

echo "  ChadScript (native)"
/tmp/bench-fib-chad 2>&1 | sed 's/^/    /'
echo ""

echo "  Go $(go version | awk '{print $3}')"
/tmp/bench-fib-go 2>&1 | sed 's/^/    /'
echo ""

echo "  Bun $(bun --version)"
bun "$DIR/fibonacci/bun.mjs" 2>&1 | sed 's/^/    /'
echo ""

echo "  Node.js $(node --version)"
node "$DIR/fibonacci/node.mjs" 2>&1 | sed 's/^/    /'
echo ""

echo "  Python $(python3 --version 2>&1 | awk '{print $2}')"
python3 "$DIR/fibonacci/fib.py" 2>&1 | sed 's/^/    /'
echo ""

echo "═══════════════════════════════════════════════════"
echo "  SQLite  (100 rows, 100K queries, in-memory)"
echo "═══════════════════════════════════════════════════"
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

echo "  Python $(python3 --version 2>&1 | awk '{print $2}')"
python3 "$DIR/sqlite/python_bench.py" 2>&1 | sed 's/^/    /'
echo ""

echo "═══════════════════════════════════════════════════"
echo "  Done"
echo "═══════════════════════════════════════════════════"
