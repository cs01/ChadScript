# Benchmarks

ChadScript compiles to native ELF binaries via LLVM. No runtime, no JIT warmup, no cold start. [See details.](https://github.com/cs01/ChadScript/tree/main/benchmarks)

<BenchmarkBars />

---

**ChadScript delivers compiled-language performance with TypeScript syntax:**

- **1.7ms cold start** — within 21% of C, 2x faster than Go, 12x faster than Bun, 34x faster than Node
- **Faster than C on compute** — ties C on 512×512 matrix multiply, beats it on Mandelbrot
- **Zero-overhead FFI** — calls C libraries directly, 72% of C's SQLite throughput
- **56x faster than Python** on startup, 146x on matrix multiply

Reproduce: `./benchmarks/run.sh` — Linux x86-64, single run, all runtimes on same machine.
