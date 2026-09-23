# Benchmarks

Each directory holds the same program three ways:

- `main.ts` — compiled to a native binary by ChadScript **and** run under Node. One source, two
  runtimes; that equivalence is the whole point of the subset.
- `main.rs` — the systems-language reference, built with `rustc -O`.

```sh
bun run scripts/bench.ts          # all benchmarks
bun run scripts/bench.ts fib      # one
```

The runner compiles `main.ts` at `-O2` through the same path as `chad build`, then **checks that
all three print identical stdout before timing anything** — a benchmark that computes something
different is not a benchmark. Reported time is best-of-5 wall clock including process startup
(which is itself a real difference: a native binary starts in ~1ms, `node` in ~30ms).

## What each one exercises

| Benchmark      | Stresses                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------- |
| `fib`          | function-call overhead, f64 arithmetic, recursion                                             |
| `sieve`        | array element writes, tight integer-ish loops                                                 |
| `matmul`       | nested array indexing, multiply-accumulate                                                    |
| `nbody`        | classes, field mutation through references, `Math.sqrt`                                       |
| `binary_trees` | allocation throughput and collector cost (millions of short-lived nodes, one long-lived tree) |

## Reading the results

Rust is the ceiling, not the target: it has unboxed `f64` arrays and no GC. The interesting
comparisons are ChadScript vs Node (both are JavaScript semantics, so this is what compilation
buys) and the _shape_ of ChadScript's gap to Rust, which points at specific representation debt
rather than general slowness.

The array-heavy benchmarks are where that debt shows: every `arr[i]` read is typed `T | undefined`
under `noUncheckedIndexedAccess`, and the optional representation heap-allocates a box per read.
In an inner loop that is millions of GC allocations, which is why `matmul` is the one benchmark
that loses to Node. An unboxed representation for statically-in-range reads is the fix; it is
tracked as representation work, not a tuning knob.

## Collector: Boehm vs our own (phase 6)

Same machine (Apple M-series, macOS), best of 5, `chad` column only; "Boehm" is v2 at 43d4d919,
"own GC" is runtime/gc.milo with the inline bump path.

| Benchmark      | Boehm  | own GC | Node   |
| -------------- | ------ | ------ | ------ |
| `binary_trees` | 267 ms | 232 ms | 130 ms |
| `fib`          | 25 ms  | 25 ms  | 96 ms  |
| `map_lookup`   | 111 ms | 105 ms | 57 ms  |
| `matmul`       | 108 ms | 105 ms | 89 ms  |
| `montecarlo`   | 935 ms | 925 ms | 1.03 s |
| `nbody`        | 127 ms | 126 ms | 248 ms |
| `sieve`        | 55 ms  | 52 ms  | 113 ms |
| `sorting`      | 49 ms  | 48 ms  | 77 ms  |

`binary_trees` still trails Node: the collector is non-generational, so every collection marks
the whole long-lived tree, where V8 only scavenges its nursery.
