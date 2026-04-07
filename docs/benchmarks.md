# Benchmarks

ChadScript compiles to native binaries via LLVM IR — no runtime, no JIT warmup, no cold start penalty.

These benchmarks compare ChadScript against C (clang -O2), Go, Bun, and Node.js across compute, I/O, and real-world workloads. Only benchmarks where ChadScript places in the **top 3** are shown.

<BenchmarkBars />

## Methodology

- **Machine**: Linux x86-64, single machine, all runtimes tested sequentially
- **Optimization**: ChadScript and C compiled with `-O2`
- **Timing**: Wall-clock time via `perf_counter` / `clock_gettime`
- **Cold start**: Average of 50 runs

Reproduce locally:

```bash
./benchmarks/run.sh
```

Source code for all benchmarks: [github.com/cs01/ChadScript/tree/main/benchmarks](https://github.com/cs01/ChadScript/tree/main/benchmarks)
