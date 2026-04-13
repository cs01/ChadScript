# Benchmarks

ChadScript compiles to native binaries via LLVM IR — no runtime, no JIT warmup, no cold start penalty.

These benchmarks compare ChadScript against C (clang -O2 -march=native), Go, and Node.js across compute, I/O, and real-world workloads.

<BenchmarkBars />

## Methodology

- **Machine**: Apple Silicon (M-series, arm64 native), dedicated hardware, all runtimes tested sequentially
- **Optimization**: ChadScript and C compiled with `-O2 -march=native`
- **Sampling**: Each compute benchmark runs **N=10 times**. The reported value is the **median** of the 10 samples, annotated with a **95% bootstrap confidence interval** (2000 resamples, `random.seed(0xC4AD)` for reproducibility).
- **Ties**: Two languages are treated as tied when their 95% CIs overlap — i.e. the difference between them is not statistically distinguishable at the 95% level. This prevents spurious medal-flipping when jitter produces a 2-3% gap that's inside both intervals.
- **Cold start**: Average of 50 launches (aggregate measurement, not per-sample).
- **Timing**: Wall-clock time via `clock_gettime` / `Date.now()` / `time.Now()`.

The CI whiskers on the bars show the 95% confidence interval. A narrow whisker means the samples were very consistent; a wide one means the runtime is variable and the point estimate should be trusted less. **Bars whose CIs visibly overlap are statistically tied** — ranking between them is meaningless.

Reproduce locally:

```bash
BENCH_RUNS=10 ./benchmarks/run.sh
```

Source code for all benchmarks: [github.com/cs01/ChadScript/tree/main/benchmarks](https://github.com/cs01/ChadScript/tree/main/benchmarks)
