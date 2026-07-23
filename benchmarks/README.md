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

| Benchmark | Stresses                                                |
| --------- | ------------------------------------------------------- |
| `fib`     | function-call overhead, f64 arithmetic, recursion       |
| `sieve`   | array element writes, tight integer-ish loops           |
| `matmul`  | nested array indexing, multiply-accumulate              |
| `nbody`   | classes, field mutation through references, `Math.sqrt` |

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
