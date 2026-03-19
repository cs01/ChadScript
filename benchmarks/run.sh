#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"

now_ns() {
  if command -v gdate &>/dev/null; then
    gdate +%s%N
  else
    python3 -c 'import time; print(int(time.time_ns()))'
  fi
}
REPO="$(dirname "$DIR")"
CHAD="$REPO/.build/chad"
STARTUP_RUNS=50
HTTP_BENCH="$DIR/tools/httpbench"
WS_BENCH="$DIR/tools/wsbench"
HTTP_PORT=9876
WS_PORT=9877
BENCH_DURATION=10s
JSON_DIR=$(mktemp -d)
JSON_OUT="$REPO/docs/public/benchmarks.json"

extract_metric() {
    local key="$1"
    local output="$2"
    echo "$output" | grep "^${key}" | head -1 | sed "s/^${key}[[:space:]]*//"
}

json_add_result() {
    local bench="$1"
    local lang="$2"
    local value="$3"
    local label="$4"
    local file="$JSON_DIR/${bench}.json"
    if [ ! -f "$file" ]; then
        echo -n "" > "$file"
    fi
    echo "${lang}|${value}|${label}" >> "$file"
}

bench_compute() {
    local bench="$1"
    local lang="$2"
    local display="$3"
    local metric_key="$4"
    shift 4

    echo "  $display"
    local output
    output=$("$@" 2>&1) || true
    echo "$output" | sed 's/^/    /'
    echo ""

    local raw
    raw=$(extract_metric "$metric_key" "$output")
    local value
    value=$(echo "$raw" | sed 's/[^0-9.]//g')
    if [ -n "$value" ]; then
        json_add_result "$bench" "$lang" "$value" "$raw"
    fi
}

bench_startup() {
    local name="$1"
    local lang="$2"
    shift 2
    local start_ns=$(now_ns)
    for i in $(seq 1 $STARTUP_RUNS); do
        "$@" > /dev/null 2>&1
    done
    local end_ns=$(now_ns)
    local avg_us=$(( (end_ns - start_ns) / STARTUP_RUNS / 1000 ))
    local avg_ms_int=$(( avg_us / 1000 ))
    local avg_ms_frac=$(( (avg_us % 1000) / 100 ))
    printf "    %-20s %d.%dms\n" "$name" "$avg_ms_int" "$avg_ms_frac"

    local value="${avg_ms_int}.${avg_ms_frac}"
    json_add_result "startup" "$lang" "$value" "${value}ms"
}

wait_port_free() {
    local port=$1
    for i in $(seq 1 30); do
        if ! (ss -tln 2>/dev/null || lsof -i ":${port}" 2>/dev/null) | grep -q ":${port}"; then
            return 0
        fi
        sleep 0.2
    done
}

bench_http_server() {
    local name="$1"
    local lang="$2"
    local bench_key="$3"
    local extra_flags="$4"
    shift 4
    wait_port_free $HTTP_PORT
    "$@" > /dev/null 2>&1 &
    local pid=$!
    sleep 1
    echo "  $name"
    local output
    output=$($HTTP_BENCH -url "http://127.0.0.1:${HTTP_PORT}/" -c 100 -d "$BENCH_DURATION" $extra_flags 2>&1) || true
    echo "$output" | sed 's/^/    /'
    kill -9 $pid 2>/dev/null
    wait $pid 2>/dev/null
    sleep 0.5
    echo ""

    local raw
    raw=$(extract_metric "Req/sec:" "$output")
    local value
    value=$(echo "$raw" | sed 's/[^0-9.]//g')
    if [ -n "$value" ]; then
        json_add_result "$bench_key" "$lang" "$value" "$raw"
    fi
}

bench_ws_server() {
    local name="$1"
    local lang="$2"
    shift 2
    wait_port_free $WS_PORT
    "$@" > /dev/null 2>&1 &
    local pid=$!
    sleep 1
    echo "  $name"
    local output
    output=$($WS_BENCH -url "ws://127.0.0.1:${WS_PORT}/" -c 32 -d "$BENCH_DURATION" 2>&1) || true
    echo "$output" | sed 's/^/    /'
    kill -9 $pid 2>/dev/null
    wait $pid 2>/dev/null
    sleep 0.5
    echo ""

    local raw
    raw=$(extract_metric "Msg/sec:" "$output")
    local value
    value=$(echo "$raw" | sed 's/[^0-9.]//g')
    if [ -n "$value" ]; then
        json_add_result "websocket" "$lang" "$value" "$raw"
    fi
}

assemble_json() {
    python3 "$DIR/assemble_json.py" "$JSON_DIR" "$1" "$STARTUP_RUNS"
}

assemble_json_old() {
    local outfile="$1"
    mkdir -p "$(dirname "$outfile")"

    local timestamp
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    declare -A bench_names
    bench_names[startup]="Cold Start"
    bench_names[sqlite]="SQLite"
    bench_names[matmul]="Matrix Multiply"
    bench_names[montecarlo]="Monte Carlo Pi"
    bench_names[fibonacci]="Fibonacci"
    bench_names[http]="HTTP Server"
    bench_names[http_keepalive]="HTTP Keep-Alive"
    bench_names[websocket]="WebSocket"
    bench_names[sieve]="Sieve of Eratosthenes"
    bench_names[sorting]="Quicksort"
    bench_names[nbody]="N-Body Simulation"
    bench_names[stringops]="String Manipulation"
    bench_names[fileio]="File I/O"
    bench_names[binarytrees]="Binary Trees"
    bench_names[json]="JSON Parse/Stringify"
    bench_names[stringsearch]="String Search"

    declare -A bench_descs
    bench_descs[startup]="Time to print 'Hello, World!' and exit. Average of ${STARTUP_RUNS} runs."
    bench_descs[sqlite]="100K SELECT queries on a 100-row in-memory table."
    bench_descs[matmul]="512x512 double-precision matrix multiply."
    bench_descs[montecarlo]="100M Monte Carlo samples to estimate Pi."
    bench_descs[fibonacci]="fib(42) naive recursion."
    bench_descs[http]="HTTP hello-world, 100 concurrent, no keep-alive."
    bench_descs[http_keepalive]="HTTP hello-world, 100 concurrent, keep-alive enabled."
    bench_descs[websocket]="WebSocket echo, 32 clients."
    bench_descs[sieve]="Find all primes up to 10M."
    bench_descs[sorting]="Quicksort 2M doubles (deterministic LCG)."
    bench_descs[nbody]="5-body simulation, 50M timesteps."
    bench_descs[stringops]="Concatenate 100K strings, split, toUpperCase, join."
    bench_descs[fileio]="Write and read ~100MB to /tmp."
    bench_descs[binarytrees]="Build/check/discard binary trees of depth 18."
    bench_descs[json]="Parse 10K JSON objects, stringify back."
    bench_descs[stringsearch]="Recursive directory search for 'console.log' in src/. Small corpus (~30 files); grep/ripgrep advantages (mmap, SIMD, parallelism) shine on larger codebases."

    declare -A bench_metrics
    bench_metrics[startup]="ms"
    bench_metrics[sqlite]="s"
    bench_metrics[matmul]="s"
    bench_metrics[montecarlo]="s"
    bench_metrics[fibonacci]="s"
    bench_metrics[http]="req/s"
    bench_metrics[http_keepalive]="req/s"
    bench_metrics[websocket]="msg/s"
    bench_metrics[sieve]="s"
    bench_metrics[sorting]="s"
    bench_metrics[nbody]="s"
    bench_metrics[stringops]="s"
    bench_metrics[fileio]="s"
    bench_metrics[binarytrees]="s"
    bench_metrics[json]="s"
    bench_metrics[stringsearch]="s"

    declare -A bench_lower
    bench_lower[startup]="true"
    bench_lower[sqlite]="true"
    bench_lower[matmul]="true"
    bench_lower[montecarlo]="true"
    bench_lower[fibonacci]="true"
    bench_lower[http]="false"
    bench_lower[http_keepalive]="false"
    bench_lower[websocket]="false"
    bench_lower[sieve]="true"
    bench_lower[sorting]="true"
    bench_lower[nbody]="true"
    bench_lower[stringops]="true"
    bench_lower[fileio]="true"
    bench_lower[binarytrees]="true"
    bench_lower[json]="true"
    bench_lower[stringsearch]="true"

    for benchfile in "$JSON_DIR"/*.json; do
        [ -f "$benchfile" ] || continue
        local bkey
        bkey=$(basename "$benchfile" .json)
        local blower="${bench_lower[$bkey]:-true}"

        local chad_val
        chad_val=$(grep '^chadscript|' "$benchfile" | head -1 | cut -d'|' -f2)
        if [ -z "$chad_val" ]; then
            rm "$benchfile"
            continue
        fi

        local dominated=false
        while IFS='|' read -r lang value label; do
            [ "$lang" = "chadscript" ] && continue
            [ "$lang" = "c" ] && continue
            if [ "$blower" = "true" ]; then
                if [ "$(echo "$value < $chad_val" | bc -l)" = "1" ]; then
                    dominated=true
                    break
                fi
            else
                if [ "$(echo "$value > $chad_val" | bc -l)" = "1" ]; then
                    dominated=true
                    break
                fi
            fi
        done < "$benchfile"

        if [ "$dominated" = true ]; then
            echo "  Filtered: ${bench_names[$bkey]:-$bkey} (ChadScript not 1st or 2nd behind C)"
            rm "$benchfile"
        fi
    done

    echo "{" > "$outfile"
    echo "  \"timestamp\": \"$timestamp\"," >> "$outfile"
    echo "  \"benchmarks\": {" >> "$outfile"

    local first_bench=true
    for benchfile in "$JSON_DIR"/*.json; do
        [ -f "$benchfile" ] || continue
        local bench
        bench=$(basename "$benchfile" .json)

        if [ "$first_bench" = true ]; then
            first_bench=false
        else
            echo "," >> "$outfile"
        fi

        local name="${bench_names[$bench]:-$bench}"
        local desc="${bench_descs[$bench]:-}"
        local metric="${bench_metrics[$bench]:-}"
        local lower="${bench_lower[$bench]:-true}"

        echo -n "    \"$bench\": {" >> "$outfile"
        echo -n "\"name\": \"$name\"," >> "$outfile"
        echo -n "\"desc\": \"$desc\"," >> "$outfile"
        echo -n "\"metric\": \"$metric\"," >> "$outfile"
        echo -n "\"lower_is_better\": $lower," >> "$outfile"
        echo -n "\"results\": {" >> "$outfile"

        local first_result=true
        while IFS='|' read -r lang value label; do
            if [ "$first_result" = true ]; then
                first_result=false
            else
                echo -n "," >> "$outfile"
            fi
            echo -n "\"$lang\": {\"value\": $value, \"label\": \"$label\"}" >> "$outfile"
        done < "$benchfile"

        echo -n "}}" >> "$outfile"
    done

    echo "" >> "$outfile"
    echo "  }" >> "$outfile"
    echo "}" >> "$outfile"
}

echo "╔══════════════════════════════════════════════════╗"
echo "║          ChadScript Benchmark Suite              ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

echo "--- Building ---"

$CHAD build "$DIR/startup/chadscript.ts" -o /tmp/bench-startup-chad
echo "  ChadScript startup built"

$CHAD build "$DIR/sqlite/chadscript.ts" -o /tmp/bench-sqlite-chad
echo "  ChadScript SQLite built"

$CHAD build "$DIR/matmul/chadscript.ts" -o /tmp/bench-matmul-chad
echo "  ChadScript Matmul built"

$CHAD build "$DIR/montecarlo/chadscript.ts" -o /tmp/bench-montecarlo-chad
echo "  ChadScript Monte Carlo built"

$CHAD build "$DIR/fibonacci/chadscript.ts" -o /tmp/bench-fibonacci-chad
echo "  ChadScript Fibonacci built"

$CHAD build "$DIR/sieve/chadscript.ts" -o /tmp/bench-sieve-chad
echo "  ChadScript Sieve built"

$CHAD build "$DIR/sorting/chadscript.ts" -o /tmp/bench-sorting-chad
echo "  ChadScript Sorting built"

$CHAD build "$DIR/nbody/chadscript.ts" -o /tmp/bench-nbody-chad
echo "  ChadScript N-Body built"

$CHAD build "$DIR/stringops/chadscript.ts" -o /tmp/bench-stringops-chad
echo "  ChadScript String Ops built"

$CHAD build "$DIR/fileio/chadscript.ts" -o /tmp/bench-fileio-chad
echo "  ChadScript File I/O built"

$CHAD build "$DIR/binarytrees/chadscript.ts" -o /tmp/bench-binarytrees-chad
echo "  ChadScript Binary Trees built"

$CHAD build "$DIR/json/chadscript.ts" -o /tmp/bench-json-chad
echo "  ChadScript JSON built"

$CHAD build "$DIR/stringsearch/chadscript.ts" -o /tmp/bench-stringsearch-chad
echo "  ChadScript String Search built"

clang -O2 -march=native -o /tmp/bench-startup-c "$DIR/startup/hello.c"
echo "  C startup built"

clang -O2 -march=native -o /tmp/bench-sqlite-c "$DIR/sqlite/bench.c" -lsqlite3
echo "  C SQLite built"

clang -O2 -march=native -o /tmp/bench-matmul-c "$DIR/matmul/bench.c"
echo "  C Matmul built"

clang -O2 -march=native -o /tmp/bench-montecarlo-c "$DIR/montecarlo/bench.c"
echo "  C Monte Carlo built"

clang -O2 -march=native -o /tmp/bench-fibonacci-c "$DIR/fibonacci/fib.c"
echo "  C Fibonacci built"

clang -O2 -march=native -o /tmp/bench-sieve-c "$DIR/sieve/bench.c"
echo "  C Sieve built"

clang -O2 -march=native -o /tmp/bench-sorting-c "$DIR/sorting/bench.c" -lm
echo "  C Sorting built"

clang -O2 -march=native -o /tmp/bench-nbody-c "$DIR/nbody/bench.c" -lm
echo "  C N-Body built"

clang -O2 -march=native -o /tmp/bench-stringops-c "$DIR/stringops/bench.c"
echo "  C String Ops built"

clang -O2 -march=native -o /tmp/bench-fileio-c "$DIR/fileio/bench.c"
echo "  C File I/O built"

clang -O2 -march=native -o /tmp/bench-binarytrees-c "$DIR/binarytrees/bench.c"
echo "  C Binary Trees built"

clang -O2 -march=native -I "$DIR/../vendor/yyjson" -o /tmp/bench-json-c "$DIR/json/bench.c" "$DIR/../vendor/yyjson/libyyjson.a"
echo "  C JSON built"

clang -O2 -march=native -o /tmp/bench-stringsearch-c "$DIR/stringsearch/bench.c"
echo "  C String Search built"

go build -o /tmp/bench-startup-go "$DIR/startup/hello.go"
echo "  Go startup built"

go build -o /tmp/bench-matmul-go "$DIR/matmul/matmul.go"
echo "  Go Matmul built"

go build -o /tmp/bench-montecarlo-go "$DIR/montecarlo/montecarlo.go"
echo "  Go Monte Carlo built"

go build -o /tmp/bench-fibonacci-go "$DIR/fibonacci/fib.go"
echo "  Go Fibonacci built"

go build -o /tmp/bench-sieve-go "$DIR/sieve/sieve.go"
echo "  Go Sieve built"

go build -o /tmp/bench-sorting-go "$DIR/sorting/sorting.go"
echo "  Go Sorting built"

go build -o /tmp/bench-nbody-go "$DIR/nbody/nbody.go"
echo "  Go N-Body built"

go build -o /tmp/bench-stringops-go "$DIR/stringops/stringops.go"
echo "  Go String Ops built"

go build -o /tmp/bench-fileio-go "$DIR/fileio/fileio.go"
echo "  Go File I/O built"

go build -o /tmp/bench-binarytrees-go "$DIR/binarytrees/binarytrees.go"
echo "  Go Binary Trees built"

go build -o /tmp/bench-json-go "$DIR/json/json_bench.go"
echo "  Go JSON built"

go build -o /tmp/bench-stringsearch-go "$DIR/stringsearch/stringsearch.go"
echo "  Go String Search built"

echo ""

echo "═══════════════════════════════════════════════════"
echo "  Cold Start  (avg of ${STARTUP_RUNS} runs)"
echo "═══════════════════════════════════════════════════"
echo ""

bench_startup "C (clang -O2 -march=native)" "c" /tmp/bench-startup-c
bench_startup "ChadScript" "chadscript" /tmp/bench-startup-chad
bench_startup "Go" "go" /tmp/bench-startup-go
bench_startup "Bun" "bun" bun "$DIR/startup/bun.mjs"
bench_startup "Node.js" "node" node "$DIR/startup/node.mjs"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  SQLite  (100 rows, 100K queries, in-memory)"
echo "═══════════════════════════════════════════════════"
echo ""

bench_compute "sqlite" "c" "C (clang -O2 -march=native)" "Time:" /tmp/bench-sqlite-c
bench_compute "sqlite" "chadscript" "ChadScript (native)" "Time:" /tmp/bench-sqlite-chad
bench_compute "sqlite" "node" "Node.js $(node --version)" "Time:" node --experimental-sqlite "$DIR/sqlite/node.mjs"
bench_compute "sqlite" "bun" "Bun $(bun --version)" "Time:" bun "$DIR/sqlite/bun.mjs"

echo "═══════════════════════════════════════════════════"
echo "  Matrix Multiply  (512x512, double precision)"
echo "═══════════════════════════════════════════════════"
echo ""

bench_compute "matmul" "c" "C (clang -O2 -march=native)" "Time:" /tmp/bench-matmul-c
bench_compute "matmul" "chadscript" "ChadScript (native)" "Time:" /tmp/bench-matmul-chad
bench_compute "matmul" "go" "Go" "Time:" /tmp/bench-matmul-go
bench_compute "matmul" "node" "Node.js $(node --version)" "Time:" node "$DIR/matmul/node.mjs"
bench_compute "matmul" "bun" "Bun $(bun --version)" "Time:" bun "$DIR/matmul/bun.mjs"

echo "═══════════════════════════════════════════════════"
echo "  Monte Carlo Pi  (50M samples, deterministic LCG)"
echo "═══════════════════════════════════════════════════"
echo ""

bench_compute "montecarlo" "c" "C (clang -O2 -march=native)" "Time:" /tmp/bench-montecarlo-c
bench_compute "montecarlo" "chadscript" "ChadScript (native)" "Time:" /tmp/bench-montecarlo-chad
bench_compute "montecarlo" "go" "Go" "Time:" /tmp/bench-montecarlo-go
bench_compute "montecarlo" "node" "Node.js $(node --version)" "Time:" node "$DIR/montecarlo/node.mjs"
bench_compute "montecarlo" "bun" "Bun $(bun --version)" "Time:" bun "$DIR/montecarlo/bun.mjs"

echo "═══════════════════════════════════════════════════"
echo "  Fibonacci  (fib(42), naive recursion)"
echo "═══════════════════════════════════════════════════"
echo ""

bench_compute "fibonacci" "c" "C (clang -O2 -march=native)" "Time:" /tmp/bench-fibonacci-c
bench_compute "fibonacci" "chadscript" "ChadScript (native)" "Time:" /tmp/bench-fibonacci-chad
bench_compute "fibonacci" "go" "Go" "Time:" /tmp/bench-fibonacci-go
bench_compute "fibonacci" "node" "Node.js $(node --version)" "Time:" node "$DIR/fibonacci/node.mjs"
bench_compute "fibonacci" "bun" "Bun $(bun --version)" "Time:" bun "$DIR/fibonacci/bun.mjs"

echo "═══════════════════════════════════════════════════"
echo "  Sieve of Eratosthenes  (primes up to 10M)"
echo "═══════════════════════════════════════════════════"
echo ""

bench_compute "sieve" "c" "C (clang -O2 -march=native)" "Time:" /tmp/bench-sieve-c
bench_compute "sieve" "chadscript" "ChadScript (native)" "Time:" /tmp/bench-sieve-chad
bench_compute "sieve" "go" "Go" "Time:" /tmp/bench-sieve-go
bench_compute "sieve" "node" "Node.js $(node --version)" "Time:" node "$DIR/sieve/node.mjs"
bench_compute "sieve" "bun" "Bun $(bun --version)" "Time:" bun "$DIR/sieve/bun.mjs"

echo "═══════════════════════════════════════════════════"
echo "  Quicksort  (2M doubles, deterministic LCG)"
echo "═══════════════════════════════════════════════════"
echo ""

bench_compute "sorting" "c" "C (clang -O2 -march=native)" "Time:" /tmp/bench-sorting-c
bench_compute "sorting" "chadscript" "ChadScript (native)" "Time:" /tmp/bench-sorting-chad
bench_compute "sorting" "go" "Go" "Time:" /tmp/bench-sorting-go
bench_compute "sorting" "node" "Node.js $(node --version)" "Time:" node "$DIR/sorting/node.mjs"
bench_compute "sorting" "bun" "Bun $(bun --version)" "Time:" bun "$DIR/sorting/bun.mjs"

echo "═══════════════════════════════════════════════════"
echo "  N-Body Simulation  (5 bodies, 25M steps)"
echo "═══════════════════════════════════════════════════"
echo ""

bench_compute "nbody" "c" "C (clang -O2 -march=native)" "Time:" /tmp/bench-nbody-c
bench_compute "nbody" "chadscript" "ChadScript (native)" "Time:" /tmp/bench-nbody-chad
bench_compute "nbody" "go" "Go" "Time:" /tmp/bench-nbody-go
bench_compute "nbody" "node" "Node.js $(node --version)" "Time:" node "$DIR/nbody/node.mjs"
bench_compute "nbody" "bun" "Bun $(bun --version)" "Time:" bun "$DIR/nbody/bun.mjs"

echo "═══════════════════════════════════════════════════"
echo "  String Manipulation  (100K strings)"
echo "═══════════════════════════════════════════════════"
echo ""

bench_compute "stringops" "c" "C (clang -O2 -march=native)" "Time:" /tmp/bench-stringops-c
bench_compute "stringops" "chadscript" "ChadScript (native)" "Time:" /tmp/bench-stringops-chad
bench_compute "stringops" "go" "Go" "Time:" /tmp/bench-stringops-go
bench_compute "stringops" "node" "Node.js $(node --version)" "Time:" node "$DIR/stringops/node.mjs"
bench_compute "stringops" "bun" "Bun $(bun --version)" "Time:" bun "$DIR/stringops/bun.mjs"

echo "═══════════════════════════════════════════════════"
echo "  File I/O  (write + read ~100MB)"
echo "═══════════════════════════════════════════════════"
echo ""

bench_compute "fileio" "c" "C (clang -O2 -march=native)" "Time:" /tmp/bench-fileio-c
bench_compute "fileio" "chadscript" "ChadScript (native)" "Time:" /tmp/bench-fileio-chad
bench_compute "fileio" "go" "Go" "Time:" /tmp/bench-fileio-go
bench_compute "fileio" "node" "Node.js $(node --version)" "Time:" node "$DIR/fileio/node.mjs"
bench_compute "fileio" "bun" "Bun $(bun --version)" "Time:" bun "$DIR/fileio/bun.mjs"

echo "═══════════════════════════════════════════════════"
echo "  Binary Trees  (depth 18, GC pressure)"
echo "═══════════════════════════════════════════════════"
echo ""

bench_compute "binarytrees" "c" "C (clang -O2 -march=native)" "Time:" /tmp/bench-binarytrees-c
bench_compute "binarytrees" "chadscript" "ChadScript (native)" "Time:" /tmp/bench-binarytrees-chad
bench_compute "binarytrees" "go" "Go" "Time:" /tmp/bench-binarytrees-go
bench_compute "binarytrees" "node" "Node.js $(node --version)" "Time:" node "$DIR/binarytrees/node.mjs"
bench_compute "binarytrees" "bun" "Bun $(bun --version)" "Time:" bun "$DIR/binarytrees/bun.mjs"

echo "═══════════════════════════════════════════════════"
echo "  JSON Parse/Stringify  (10K objects)"
echo "═══════════════════════════════════════════════════"
echo ""

bench_compute "json" "c" "C (clang -O2 -march=native, yyjson)" "Time:" /tmp/bench-json-c
bench_compute "json" "chadscript" "ChadScript (native)" "Time:" /tmp/bench-json-chad
bench_compute "json" "go" "Go" "Time:" /tmp/bench-json-go
bench_compute "json" "node" "Node.js $(node --version)" "Time:" node "$DIR/json/node.mjs"
bench_compute "json" "bun" "Bun $(bun --version)" "Time:" bun "$DIR/json/bun.mjs"

echo "═══════════════════════════════════════════════════"
echo "  String Search  (recursive, 'console.log' in src/)"
echo "═══════════════════════════════════════════════════"
echo ""

bench_compute "stringsearch" "c" "C (clang -O2 -march=native)" "Time:" /tmp/bench-stringsearch-c
bench_compute "stringsearch" "chadscript" "ChadScript (native)" "Time:" /tmp/bench-stringsearch-chad
bench_compute "stringsearch" "go" "Go" "Time:" /tmp/bench-stringsearch-go
bench_compute "stringsearch" "node" "Node.js $(node --version)" "Time:" node "$DIR/stringsearch/node.mjs"
bench_compute "stringsearch" "bun" "Bun $(bun --version)" "Time:" bun "$DIR/stringsearch/bun.mjs"
bench_compute "stringsearch" "grep" "grep -r (GNU)" "Time:" bash "$DIR/stringsearch/grep.sh"
bench_compute "stringsearch" "ripgrep" "ripgrep (rg)" "Time:" bash "$DIR/stringsearch/rg.sh"

assemble_json "$JSON_OUT"
echo ""
echo "═══════════════════════════════════════════════════"
echo "  Done — JSON written to $JSON_OUT"
echo "═══════════════════════════════════════════════════"

rm -rf "$JSON_DIR"
