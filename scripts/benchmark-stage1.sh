#!/bin/bash
set -e

NATIVE_COMPILER=".build/src/native-compiler"
BENCH_DIR="/tmp/chadscript-benchmarks"
RESULTS_FILE="$BENCH_DIR/results.txt"
ITERATIONS=5

mkdir -p "$BENCH_DIR"

echo "=== ChadScript Stage 1 Compilation Benchmark ===" | tee "$RESULTS_FILE"
echo "Date: $(date)" | tee -a "$RESULTS_FILE"
echo "Native compiler: $NATIVE_COMPILER" | tee -a "$RESULTS_FILE"
echo "Iterations per test: $ITERATIONS" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

benchmark_file() {
  local label="$1"
  local compiler="$2"
  local input="$3"
  local output="$4"
  local times=()
  local failed=0

  for i in $(seq 1 $ITERATIONS); do
    rm -f "$output" "$output.ll" "$output.o"
    start=$(date +%s%N)
    if timeout 300 "$compiler" "$input" -o "$output" > /dev/null 2>&1; then
      end=$(date +%s%N)
      elapsed_ms=$(( (end - start) / 1000000 ))
      times+=("$elapsed_ms")
    else
      end=$(date +%s%N)
      elapsed_ms=$(( (end - start) / 1000000 ))
      times+=("FAIL")
      failed=$((failed + 1))
    fi
  done

  if [ "$failed" -eq "$ITERATIONS" ]; then
    echo "$label: FAILED (all $ITERATIONS runs crashed)" | tee -a "$RESULTS_FILE"
    return 1
  elif [ "$failed" -gt 0 ]; then
    echo "$label: PARTIAL ($failed/$ITERATIONS failed) [${times[*]}]" | tee -a "$RESULTS_FILE"
    return 0
  fi

  local sum=0
  local min=${times[0]}
  local max=${times[0]}
  for t in "${times[@]}"; do
    sum=$((sum + t))
    if [ "$t" -lt "$min" ]; then min=$t; fi
    if [ "$t" -gt "$max" ]; then max=$t; fi
  done
  local avg=$((sum / ITERATIONS))

  echo "$label: avg=${avg}ms min=${min}ms max=${max}ms [${times[*]}]" | tee -a "$RESULTS_FILE"
}

FIXTURES=(
  "tests/fixtures/control-flow/simple-if.ts"
  "tests/fixtures/builtins/word-count-test.ts"
  "tests/fixtures/classes/class-string-array-test.ts"
  "tests/fixtures/interfaces/stable-struct.ts"
  "tests/fixtures/generics/string-map.ts"
)

echo "--- Part 1: Baseline Stage 1 Compilation Times (with __gc_disable + generateParts) ---" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

for fixture in "${FIXTURES[@]}"; do
  if [ -f "$fixture" ]; then
    name=$(basename "$fixture" | sed 's/\.[^.]*$//')
    benchmark_file "baseline/$name" "$NATIVE_COMPILER" "$fixture" "$BENCH_DIR/$name"
  else
    echo "SKIP: $fixture (not found)" | tee -a "$RESULTS_FILE"
  fi
done

echo "" | tee -a "$RESULTS_FILE"
echo "--- Part 2: Impact of __gc_disable() ---" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

echo "Building native compiler WITHOUT __gc_disable()..." | tee -a "$RESULTS_FILE"
python3 - << 'PYEOF'
with open('src/native-compiler.ts', 'r') as f:
    content = f.read()
content = content.replace('  __gc_disable();\n', '  // __gc_disable(); // BENCHMARK: removed\n')
with open('src/native-compiler-no-gc-disable.ts', 'w') as f:
    f.write(content)
PYEOF

rm -f "$BENCH_DIR/native-compiler-no-gc-disable" "$BENCH_DIR/native-compiler-no-gc-disable.ll" "$BENCH_DIR/native-compiler-no-gc-disable.o"
if timeout 300 "$NATIVE_COMPILER" src/native-compiler-no-gc-disable.ts -o "$BENCH_DIR/native-compiler-no-gc-disable" > /dev/null 2>&1; then
  echo "Built successfully" | tee -a "$RESULTS_FILE"
  echo "" | tee -a "$RESULTS_FILE"

  echo "WITHOUT __gc_disable() (GC active during compilation):" | tee -a "$RESULTS_FILE"
  for fixture in "${FIXTURES[@]}"; do
    if [ -f "$fixture" ]; then
      name=$(basename "$fixture" | sed 's/\.[^.]*$//')
      benchmark_file "gc-enabled/$name" "$BENCH_DIR/native-compiler-no-gc-disable" "$fixture" "$BENCH_DIR/nogc-$name" || true
    fi
  done
else
  echo "FAILED to build no-gc-disable variant" | tee -a "$RESULTS_FILE"
fi

echo "" | tee -a "$RESULTS_FILE"
echo "--- Part 3: Impact of generateParts() vs generate() ---" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

echo "Building native compiler with generate() instead of generateParts()..." | tee -a "$RESULTS_FILE"
python3 - << 'PYEOF'
with open('src/native-compiler.ts', 'r') as f:
    content = f.read()

old_block = """  const irParts = generator.generateParts();
  console.log('Generated IR parts: ' + irParts.length);

  const irFile = outputFile + '.ll';
  fs.writeFileSync(irFile, '');
  for (let pi = 0; pi < irParts.length; pi++) {
    const part = irParts[pi];
    if (part.indexOf('ts_parser_language') !== -1) {
      const preview = part.substr(0, 80);
      console.log('Part ' + pi + ' contains ts_parser_language, len=' + part.length + ' preview=' + preview);
    }
    fs.appendFileSync(irFile, part);
  }"""

new_block = """  const irSingle = generator.generate();
  console.log('Generated IR (single string)');

  const irFile = outputFile + '.ll';
  fs.writeFileSync(irFile, irSingle);"""

content = content.replace(old_block, new_block)

with open('src/native-compiler-generate.ts', 'w') as f:
    f.write(content)
PYEOF

rm -f "$BENCH_DIR/native-compiler-generate" "$BENCH_DIR/native-compiler-generate.ll" "$BENCH_DIR/native-compiler-generate.o"
if timeout 300 "$NATIVE_COMPILER" src/native-compiler-generate.ts -o "$BENCH_DIR/native-compiler-generate" > /dev/null 2>&1; then
  echo "Built successfully" | tee -a "$RESULTS_FILE"
  echo "" | tee -a "$RESULTS_FILE"

  echo "With generate() (single string, single writeFileSync):" | tee -a "$RESULTS_FILE"
  for fixture in "${FIXTURES[@]}"; do
    if [ -f "$fixture" ]; then
      name=$(basename "$fixture" | sed 's/\.[^.]*$//')
      benchmark_file "generate/$name" "$BENCH_DIR/native-compiler-generate" "$fixture" "$BENCH_DIR/gen-$name" || true
    fi
  done
else
  echo "FAILED to build generate() variant" | tee -a "$RESULTS_FILE"
fi

echo "" | tee -a "$RESULTS_FILE"
echo "--- Part 4: Stage 0 (native) vs tsx (Node.js) Compilation Speed ---" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

for fixture in "${FIXTURES[@]}"; do
  if [ -f "$fixture" ]; then
    name=$(basename "$fixture" | sed 's/\.[^.]*$//')
    rm -f "$BENCH_DIR/tsx-$name" "$BENCH_DIR/tsx-$name.ll" "$BENCH_DIR/tsx-$name.o"
    start=$(date +%s%N)
    if timeout 60 npx tsx src/index.ts "$fixture" -o "$BENCH_DIR/tsx-$name" --skip-semantic-analysis > /dev/null 2>&1; then
      end=$(date +%s%N)
      elapsed_ms=$(( (end - start) / 1000000 ))
      echo "tsx/$name: ${elapsed_ms}ms" | tee -a "$RESULTS_FILE"
    else
      end=$(date +%s%N)
      elapsed_ms=$(( (end - start) / 1000000 ))
      echo "tsx/$name: FAILED after ${elapsed_ms}ms" | tee -a "$RESULTS_FILE"
    fi
  fi
done

echo "" | tee -a "$RESULTS_FILE"
echo "=== Benchmark Complete ===" | tee -a "$RESULTS_FILE"
echo "Full results saved to: $RESULTS_FILE" | tee -a "$RESULTS_FILE"

rm -f src/native-compiler-no-gc-disable.ts src/native-compiler-generate.ts
