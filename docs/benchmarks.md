# Benchmarks

ChadScript compiles to native ELF binaries via LLVM. No runtime, no JIT warmup, no cold start. [See details.](https://github.com/cs01/ChadScript/tree/main/benchmarks)

<BenchmarkBars />

---

**ChadScript delivers compiled-language performance with TypeScript syntax:**

- **1.7ms cold start** — within 13% of C, 2x faster than Go, 11x faster than Bun, 34x faster than Node
- **Ties C on compute** — matches C and Go on 512×512 matrix multiply, faster than Bun/Node
- **Zero-overhead FFI** — calls C libraries directly, 70% of C's SQLite throughput, 1.7x faster than Bun, 2.4x faster than Node

Reproduce: `./benchmarks/run.sh` — Linux x86-64, single run, all runtimes on same machine.
