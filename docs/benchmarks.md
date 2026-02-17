# Benchmarks

ChadScript compiles to native ELF binaries via LLVM. No runtime, no JIT warmup, no cold start. [See details.](https://github.com/cs01/ChadScript/tree/main/benchmarks)

<BenchmarkBars />

---

**ChadScript delivers compiled-language performance with TypeScript syntax:**

- **1.0ms cold start** — faster than C, 4x faster than Go, 54x faster than Node
- **1.01s Monte Carlo** — 1.16x C, 3.4x faster than Node, 16x faster than Bun
- **0.302s SQLite** — 1.29x C, 2.3x faster than Node
- **2.73s Binary Trees** — faster than Go (4.19s) and Node (2.16s)

Reproduce: `./benchmarks/run.sh` — Linux x86-64, single run, all runtimes on same machine.
