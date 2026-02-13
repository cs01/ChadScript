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

$CHAD "$DIR/sqlite/chadscript.ts" -o /tmp/bench-sqlite-chad
echo "  ChadScript SQLite built"

$CHAD "$DIR/nbody/chadscript.ts" -o /tmp/bench-nbody-chad
echo "  ChadScript N-Body built"

$CHAD "$DIR/matmul/chadscript.ts" -o /tmp/bench-matmul-chad
echo "  ChadScript Matmul built"

$CHAD "$DIR/montecarlo/chadscript.ts" -o /tmp/bench-montecarlo-chad
echo "  ChadScript Monte Carlo built"

clang -O2 -o /tmp/bench-startup-c "$DIR/startup/hello.c"
echo "  C startup built"

clang -O2 -o /tmp/bench-sqlite-c "$DIR/sqlite/bench.c" -lsqlite3
echo "  C SQLite built"

clang -O2 -o /tmp/bench-nbody-c "$DIR/nbody/bench.c" -lm
echo "  C N-Body built"

clang -O2 -o /tmp/bench-matmul-c "$DIR/matmul/bench.c"
echo "  C Matmul built"

clang -O2 -o /tmp/bench-montecarlo-c "$DIR/montecarlo/bench.c"
echo "  C Monte Carlo built"

go build -o /tmp/bench-startup-go "$DIR/startup/hello.go"
echo "  Go startup built"

go build -o /tmp/bench-nbody-go "$DIR/nbody/nbody.go"
echo "  Go N-Body built"

go build -o /tmp/bench-matmul-go "$DIR/matmul/matmul.go"
echo "  Go Matmul built"

go build -o /tmp/bench-montecarlo-go "$DIR/montecarlo/montecarlo.go"
echo "  Go Monte Carlo built"

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

bench_startup "C (clang -O2)" /tmp/bench-startup-c
bench_startup "ChadScript" /tmp/bench-startup-chad
bench_startup "Go" /tmp/bench-startup-go
bench_startup "Bun" bun "$DIR/startup/bun.mjs"
bench_startup "Node.js" node "$DIR/startup/node.mjs"
bench_startup "Python" python3 "$DIR/startup/hello.py"

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

echo "  Python $(python3 --version 2>&1 | awk '{print $2}')"
python3 "$DIR/sqlite/python_bench.py" 2>&1 | sed 's/^/    /'
echo ""

echo "═══════════════════════════════════════════════════"
echo "  N-Body  (5 bodies, 50M steps)"
echo "═══════════════════════════════════════════════════"
echo ""

echo "  C (clang -O2)"
/tmp/bench-nbody-c 2>&1 | sed 's/^/    /'
echo ""

echo "  ChadScript (native)"
/tmp/bench-nbody-chad 2>&1 | sed 's/^/    /'
echo ""

echo "  Go"
/tmp/bench-nbody-go 2>&1 | sed 's/^/    /'
echo ""

echo "  Node.js $(node --version)"
node "$DIR/nbody/node.mjs" 2>&1 | sed 's/^/    /'
echo ""

echo "  Bun $(bun --version)"
bun "$DIR/nbody/bun.mjs" 2>&1 | sed 's/^/    /'
echo ""

echo "  Python $(python3 --version 2>&1 | awk '{print $2}')"
python3 "$DIR/nbody/nbody.py" 2>&1 | sed 's/^/    /'
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

echo "  Python $(python3 --version 2>&1 | awk '{print $2}')"
python3 "$DIR/matmul/matmul.py" 2>&1 | sed 's/^/    /'
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

echo "  Python $(python3 --version 2>&1 | awk '{print $2}')"
python3 "$DIR/montecarlo/montecarlo.py" 2>&1 | sed 's/^/    /'
echo ""

echo "═══════════════════════════════════════════════════"
echo "  Done"
echo "═══════════════════════════════════════════════════"
