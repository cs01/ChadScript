# Benchmarks

ChadScript compiles to native ELF binaries via LLVM. No runtime, no JIT warmup, no cold start.

<BenchmarkBars />

---

**ChadScript delivers compiled-language performance with TypeScript syntax:**

- **7ms cold start** — 9x faster than Node, 3x faster than Bun
- **Native CPU speed** — within 10% of Go, 2x faster than Bun
- **Zero-overhead FFI** — calls C libraries as fast as C itself
- **31x faster than Python** on compute-bound workloads

Reproduce: `./benchmarks/run.sh` — Linux x86-64, single run, all runtimes on same machine.
