# Benchmarks

Each benchmark in [`benchmarks/`](https://github.com/cs01/ChadScript/tree/main/benchmarks) is one
`main.ts`, compiled to a native binary by ChadScript **and** run under Node, plus a `main.rs`
reference built with `rustc -O`. Before timing anything, the runner checks that all three print
identical output; a benchmark that computes something different is thrown out.

<BenchBars />

<!--@include: ./generated/benchmarks.md-->

## Startup and size

Most of these programs finish in tens of milliseconds, so process startup is part of every
number above. Measured separately for `examples/shapes.ts` on the same machine and date with
`hyperfine -N` (40 runs, mean):

|                                        | Time          | Notes                                                              |
| -------------------------------------- | ------------- | ------------------------------------------------------------------ |
| native binary                          | 1.4 ms ± 0.2  | 128 KB at `-O2` (119 KB stripped); links only the system C library |
| `node --import tsx examples/shapes.ts` | 42.6 ms ± 1.2 | Node v25.3.0                                                       |
| `node examples/shapes.ts`              | 45.3 ms ± 1.3 | Node's built-in type stripping                                     |

## Reading the results

Rust is the ceiling, not the target: it has unboxed `f64` arrays and no garbage collector. The
interesting comparison is ChadScript against Node, because both implement JavaScript semantics
for the same source: that difference is what ahead-of-time compilation buys.

The benchmarks that lose to Node point at known work, not general slowness:

- `map_lookup` and `matmul`: under `noUncheckedIndexedAccess` every `arr[i]` read is typed
  `T | undefined`, and hot loops pay for that representation. An unboxed representation for reads
  that are provably in range is the planned fix.
- `binary_trees` is allocation-bound. V8's generational collector handles short-lived objects in
  a nursery; ChadScript's collector is new and has no nursery yet (planned).

## Regenerating

```sh
bun run docs/scripts/bench-page.ts      # runs scripts/bench.ts (slow), rewrites the table
```

The script records the machine, OS, toolchain versions and date with the numbers. Numbers from
different machines are not comparable; rerun all of them together.
