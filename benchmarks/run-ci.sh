#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$DIR")"
CHAD="$REPO/.build/chad"
STARTUP_RUNS=50
JSON_DIR=$(mktemp -d)
JSON_OUT="$REPO/docs/public/benchmarks.json"

now_ns() {
  date +%s%N 2>/dev/null || python3 -c 'import time; print(int(time.time_ns()))'
}

extract_metric() {
    local key="$1"
    local output="$2"
    echo "$output" | grep "^${key}" | head -1 | sed "s/^${key}[[:space:]]*//"
}

json_add_result() {
    local bench="$1" lang="$2" value="$3" label="$4"
    echo "${lang}|${value}|${label}" >> "$JSON_DIR/${bench}.json"
}

bench_compute() {
    local bench="$1" lang="$2" display="$3" metric_key="$4"
    shift 4
    echo "  $display"
    local output
    output=$("$@" 2>&1) || true
    echo "$output" | sed 's/^/    /'
    echo ""
    local raw value
    raw=$(extract_metric "$metric_key" "$output")
    value=$(echo "$raw" | sed 's/[^0-9.]//g')
    [ -n "$value" ] && json_add_result "$bench" "$lang" "$value" "$raw"
}

bench_startup() {
    local name="$1" lang="$2"
    shift 2
    local start_ns=$(now_ns)
    for i in $(seq 1 $STARTUP_RUNS); do "$@" > /dev/null 2>&1; done
    local end_ns=$(now_ns)
    local avg_us=$(( (end_ns - start_ns) / STARTUP_RUNS / 1000 ))
    local avg_ms_int=$(( avg_us / 1000 ))
    local avg_ms_frac=$(( (avg_us % 1000) / 100 ))
    printf "    %-20s %d.%dms\n" "$name" "$avg_ms_int" "$avg_ms_frac"
    json_add_result "startup" "$lang" "${avg_ms_int}.${avg_ms_frac}" "${avg_ms_int}.${avg_ms_frac}ms"
}

echo "--- Building ChadScript benchmarks ---"
$CHAD build "$DIR/startup/chadscript.ts" -o /tmp/bench-startup-chad
$CHAD build "$DIR/sqlite/chadscript.ts" -o /tmp/bench-sqlite-chad
$CHAD build "$DIR/fibonacci/chadscript.ts" -o /tmp/bench-fibonacci-chad
$CHAD build "$DIR/nbody/chadscript.ts" -o /tmp/bench-nbody-chad
$CHAD build "$DIR/json/chadscript.ts" -o /tmp/bench-json-chad
$CHAD build "$DIR/sieve/chadscript.ts" -o /tmp/bench-sieve-chad
echo "  done"

echo "--- Building C benchmarks ---"
clang -O2 -o /tmp/bench-startup-c "$DIR/startup/hello.c"
clang -O2 -o /tmp/bench-sqlite-c "$DIR/sqlite/bench.c" -lsqlite3
clang -O2 -o /tmp/bench-fibonacci-c "$DIR/fibonacci/fib.c"
clang -O2 -o /tmp/bench-nbody-c "$DIR/nbody/bench.c" -lm
clang -O2 -I "$DIR/../vendor/yyjson" -o /tmp/bench-json-c "$DIR/json/bench.c" "$DIR/../vendor/yyjson/libyyjson.a"
clang -O2 -o /tmp/bench-sieve-c "$DIR/sieve/bench.c"
echo "  done"

echo "--- Building Go benchmarks ---"
go build -o /tmp/bench-startup-go "$DIR/startup/hello.go"
go build -o /tmp/bench-fibonacci-go "$DIR/fibonacci/fib.go"
go build -o /tmp/bench-nbody-go "$DIR/nbody/nbody.go"
go build -o /tmp/bench-json-go "$DIR/json/json_bench.go"
go build -o /tmp/bench-sieve-go "$DIR/sieve/sieve.go"
echo "  done"

echo ""
echo "=== Cold Start (avg of $STARTUP_RUNS runs) ==="
bench_startup "C" "c" /tmp/bench-startup-c
bench_startup "ChadScript" "chadscript" /tmp/bench-startup-chad
bench_startup "Go" "go" /tmp/bench-startup-go
bench_startup "Bun" "bun" bun "$DIR/startup/bun.mjs"
bench_startup "Node.js" "node" node "$DIR/startup/node.mjs"

echo ""
echo "=== SQLite (100K queries) ==="
bench_compute "sqlite" "c" "C" "Time:" /tmp/bench-sqlite-c
bench_compute "sqlite" "chadscript" "ChadScript" "Time:" /tmp/bench-sqlite-chad
bench_compute "sqlite" "node" "Node.js" "Time:" node --experimental-sqlite "$DIR/sqlite/node.mjs"
bench_compute "sqlite" "bun" "Bun" "Time:" bun "$DIR/sqlite/bun.mjs"

echo "=== Fibonacci (fib 42) ==="
bench_compute "fibonacci" "c" "C" "Time:" /tmp/bench-fibonacci-c
bench_compute "fibonacci" "chadscript" "ChadScript" "Time:" /tmp/bench-fibonacci-chad
bench_compute "fibonacci" "go" "Go" "Time:" /tmp/bench-fibonacci-go
bench_compute "fibonacci" "node" "Node.js" "Time:" node "$DIR/fibonacci/node.mjs"
bench_compute "fibonacci" "bun" "Bun" "Time:" bun "$DIR/fibonacci/bun.mjs"

echo "=== N-Body (50M steps) ==="
bench_compute "nbody" "c" "C" "Time:" /tmp/bench-nbody-c
bench_compute "nbody" "chadscript" "ChadScript" "Time:" /tmp/bench-nbody-chad
bench_compute "nbody" "go" "Go" "Time:" /tmp/bench-nbody-go
bench_compute "nbody" "node" "Node.js" "Time:" node "$DIR/nbody/node.mjs"
bench_compute "nbody" "bun" "Bun" "Time:" bun "$DIR/nbody/bun.mjs"

echo "=== JSON Parse/Stringify (10K objects) ==="
bench_compute "json" "c" "C (yyjson)" "Time:" /tmp/bench-json-c
bench_compute "json" "chadscript" "ChadScript" "Time:" /tmp/bench-json-chad
bench_compute "json" "go" "Go" "Time:" /tmp/bench-json-go
bench_compute "json" "node" "Node.js" "Time:" node "$DIR/json/node.mjs"
bench_compute "json" "bun" "Bun" "Time:" bun "$DIR/json/bun.mjs"

echo "=== Sieve of Eratosthenes (10M) ==="
bench_compute "sieve" "c" "C" "Time:" /tmp/bench-sieve-c
bench_compute "sieve" "chadscript" "ChadScript" "Time:" /tmp/bench-sieve-chad
bench_compute "sieve" "go" "Go" "Time:" /tmp/bench-sieve-go
bench_compute "sieve" "node" "Node.js" "Time:" node "$DIR/sieve/node.mjs"
bench_compute "sieve" "bun" "Bun" "Time:" bun "$DIR/sieve/bun.mjs"

echo ""
echo "--- Assembling JSON ---"
python3 "$DIR/assemble_json.py" "$JSON_DIR" "$JSON_OUT" "$STARTUP_RUNS"
rm -rf "$JSON_DIR"
echo "=== Done ==="
