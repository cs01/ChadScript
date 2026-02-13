# Benchmarks

ChadScript compiles to native ELF binaries via LLVM. No runtime, no JIT warmup, no cold start.

<BenchmarkBars />

---

**ChadScript delivers compiled-language performance with TypeScript syntax:**

- **1.7ms cold start** — 2x faster than Go, 11x faster than Bun, 33x faster than Node
- **Native CPU speed** — within 15% of Go, 35% faster than Bun
- **Zero-overhead FFI** — calls C libraries as fast as C itself
- **30x faster than Python** on compute-bound workloads

Reproduce: `./benchmarks/run.sh` — Linux x86-64, single run, all runtimes on same machine.
