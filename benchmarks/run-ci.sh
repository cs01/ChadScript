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

CLI_RUNS=10
bench_cli() {
    local bench="$1" lang="$2" display="$3"
    shift 3
    echo "  $display"
    local start_ns=$(now_ns)
    for i in $(seq 1 $CLI_RUNS); do "$@" > /dev/null 2>&1 || true; done
    local end_ns=$(now_ns)
    local total_ms=$(( (end_ns - start_ns) / 1000000 ))
    local avg_ms=$(( total_ms / CLI_RUNS ))
    local sec=$(( avg_ms / 1000 ))
    local frac=$(printf "%03d" $(( avg_ms % 1000 )))
    local result="${sec}.${frac}"
    printf "    %-20s %ss (avg of %d runs)\n" "$display" "$result" "$CLI_RUNS"
    json_add_result "$bench" "$lang" "$result" "${result}s"
}

echo "--- Building ChadScript benchmarks ---"
$CHAD build "$DIR/startup/chadscript.ts" -o /tmp/bench-startup-chad
$CHAD build "$DIR/sqlite/chadscript.ts" -o /tmp/bench-sqlite-chad
$CHAD build "$DIR/fibonacci/chadscript.ts" -o /tmp/bench-fibonacci-chad
$CHAD build "$DIR/nbody/chadscript.ts" -o /tmp/bench-nbody-chad
$CHAD build "$DIR/json/chadscript.ts" -o /tmp/bench-json-chad
$CHAD build "$DIR/sieve/chadscript.ts" -o /tmp/bench-sieve-chad
$CHAD build "$DIR/montecarlo/chadscript.ts" -o /tmp/bench-montecarlo-chad
$CHAD build "$DIR/sorting/chadscript.ts" -o /tmp/bench-sorting-chad
$CHAD build "$DIR/matmul/chadscript.ts" -o /tmp/bench-matmul-chad
$CHAD build "$DIR/stringops/chadscript.ts" -o /tmp/bench-stringops-chad
$CHAD build "$DIR/binarytrees/chadscript.ts" -o /tmp/bench-binarytrees-chad
$CHAD build "$DIR/fileio/chadscript.ts" -o /tmp/bench-fileio-chad
echo "  done"

echo "--- Building C benchmarks ---"
clang -O2 -o /tmp/bench-startup-c "$DIR/startup/hello.c"
clang -O2 -o /tmp/bench-sqlite-c "$DIR/sqlite/bench.c" -lsqlite3
clang -O2 -o /tmp/bench-fibonacci-c "$DIR/fibonacci/fib.c"
clang -O2 -o /tmp/bench-nbody-c "$DIR/nbody/bench.c" -lm
clang -O2 -I "$DIR/../vendor/yyjson" -o /tmp/bench-json-c "$DIR/json/bench.c" "$DIR/../vendor/yyjson/libyyjson.a"
clang -O2 -o /tmp/bench-sieve-c "$DIR/sieve/bench.c"
clang -O2 -o /tmp/bench-montecarlo-c "$DIR/montecarlo/bench.c" -lm
clang -O2 -o /tmp/bench-sorting-c "$DIR/sorting/bench.c"
clang -O2 -o /tmp/bench-matmul-c "$DIR/matmul/bench.c" -lm
clang -O2 -o /tmp/bench-stringops-c "$DIR/stringops/bench.c"
clang -O2 -o /tmp/bench-binarytrees-c "$DIR/binarytrees/bench.c"
clang -O2 -o /tmp/bench-fileio-c "$DIR/fileio/bench.c"
echo "  done"

echo "--- Building Go benchmarks ---"
go build -o /tmp/bench-startup-go "$DIR/startup/hello.go"
go build -o /tmp/bench-fibonacci-go "$DIR/fibonacci/fib.go"
go build -o /tmp/bench-nbody-go "$DIR/nbody/nbody.go"
go build -o /tmp/bench-json-go "$DIR/json/json_bench.go"
go build -o /tmp/bench-sieve-go "$DIR/sieve/sieve.go"
go build -o /tmp/bench-montecarlo-go "$DIR/montecarlo/montecarlo.go"
go build -o /tmp/bench-sorting-go "$DIR/sorting/sorting.go"
go build -o /tmp/bench-matmul-go "$DIR/matmul/matmul.go"
go build -o /tmp/bench-stringops-go "$DIR/stringops/stringops.go"
go build -o /tmp/bench-binarytrees-go "$DIR/binarytrees/binarytrees.go"
go build -o /tmp/bench-fileio-go "$DIR/fileio/fileio.go"
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

echo "=== Monte Carlo Pi (50M samples) ==="
bench_compute "montecarlo" "c" "C" "Time:" /tmp/bench-montecarlo-c
bench_compute "montecarlo" "chadscript" "ChadScript" "Time:" /tmp/bench-montecarlo-chad
bench_compute "montecarlo" "go" "Go" "Time:" /tmp/bench-montecarlo-go
bench_compute "montecarlo" "node" "Node.js" "Time:" node "$DIR/montecarlo/node.mjs"
bench_compute "montecarlo" "bun" "Bun" "Time:" bun "$DIR/montecarlo/bun.mjs"

echo "=== Quicksort (2M doubles) ==="
bench_compute "sorting" "c" "C" "Time:" /tmp/bench-sorting-c
bench_compute "sorting" "chadscript" "ChadScript" "Time:" /tmp/bench-sorting-chad
bench_compute "sorting" "go" "Go" "Time:" /tmp/bench-sorting-go
bench_compute "sorting" "node" "Node.js" "Time:" node "$DIR/sorting/node.mjs"
bench_compute "sorting" "bun" "Bun" "Time:" bun "$DIR/sorting/bun.mjs"

echo "=== Matrix Multiply (512x512) ==="
bench_compute "matmul" "c" "C" "Time:" /tmp/bench-matmul-c
bench_compute "matmul" "chadscript" "ChadScript" "Time:" /tmp/bench-matmul-chad
bench_compute "matmul" "go" "Go" "Time:" /tmp/bench-matmul-go
bench_compute "matmul" "node" "Node.js" "Time:" node "$DIR/matmul/node.mjs"
bench_compute "matmul" "bun" "Bun" "Time:" bun "$DIR/matmul/bun.mjs"

echo "=== String Manipulation (100K strings) ==="
bench_compute "stringops" "c" "C" "Time:" /tmp/bench-stringops-c
bench_compute "stringops" "chadscript" "ChadScript" "Time:" /tmp/bench-stringops-chad
bench_compute "stringops" "go" "Go" "Time:" /tmp/bench-stringops-go
bench_compute "stringops" "node" "Node.js" "Time:" node "$DIR/stringops/node.mjs"
bench_compute "stringops" "bun" "Bun" "Time:" bun "$DIR/stringops/bun.mjs"

echo "=== Binary Trees (depth 18) ==="
bench_compute "binarytrees" "c" "C" "Time:" /tmp/bench-binarytrees-c
bench_compute "binarytrees" "chadscript" "ChadScript" "Time:" /tmp/bench-binarytrees-chad
bench_compute "binarytrees" "go" "Go" "Time:" /tmp/bench-binarytrees-go
bench_compute "binarytrees" "node" "Node.js" "Time:" node "$DIR/binarytrees/node.mjs"
bench_compute "binarytrees" "bun" "Bun" "Time:" bun "$DIR/binarytrees/bun.mjs"

echo "=== File I/O (100MB read/write) ==="
bench_compute "fileio" "c" "C" "Time:" /tmp/bench-fileio-c
bench_compute "fileio" "chadscript" "ChadScript" "Time:" /tmp/bench-fileio-chad
bench_compute "fileio" "go" "Go" "Time:" /tmp/bench-fileio-go
bench_compute "fileio" "node" "Node.js" "Time:" node "$DIR/fileio/node.mjs"
bench_compute "fileio" "bun" "Bun" "Time:" bun "$DIR/fileio/bun.mjs"

echo ""
echo "--- Building ChadScript CLI tools ---"
$CHAD build "$REPO/examples/cli-tools/cgrep.ts" -o /tmp/bench-cgrep
$CHAD build "$REPO/examples/cli-tools/chex.ts" -o /tmp/bench-chex
echo "  done"

echo ""
echo "--- Generating CLI benchmark data ---"
mkdir -p /tmp/bench-grep-data
for copy in 1 2 3 4 5; do
  cp -r "$REPO/src" "/tmp/bench-grep-data/src-$copy"
done
dd if=/dev/urandom of=/tmp/bench-hex-data bs=1M count=5 2>/dev/null
echo "  done (grep: 5x src/, hex: 5MB)"

echo ""
echo "=== CLI: Recursive Grep (search 5x src/ for 'function') ==="
bench_cli "cligrep" "chadscript" "cgrep" /tmp/bench-cgrep -r -c -C function /tmp/bench-grep-data
bench_cli "cligrep" "grep" "grep" grep -r -c function /tmp/bench-grep-data
bench_cli "cligrep" "node" "Node.js" node "$DIR/cligrep/node-grep.mjs" function /tmp/bench-grep-data
if command -v rg &>/dev/null; then
  bench_cli "cligrep" "ripgrep" "ripgrep" rg -c function /tmp/bench-grep-data
fi

echo ""
echo "=== CLI: Hex Dump (5MB binary) ==="
bench_cli "clihex" "chadscript" "chex" /tmp/bench-chex -C /tmp/bench-hex-data
bench_cli "clihex" "xxd" "xxd" xxd /tmp/bench-hex-data
bench_cli "clihex" "node" "Node.js" node "$DIR/clihex/node-hex.mjs" /tmp/bench-hex-data

rm -rf /tmp/bench-grep-data /tmp/bench-hex-data

echo ""
echo "--- Assembling JSON ---"
python3 "$DIR/assemble_json.py" "$JSON_DIR" "$JSON_OUT" "$STARTUP_RUNS"
rm -rf "$JSON_DIR"
echo "=== Done ==="
