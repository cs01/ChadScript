# Benchmarks

ChadScript compiles to native ELF binaries via LLVM. No runtime, no JIT warmup, no cold start. [See details.](https://github.com/cs01/ChadScript/tree/main/benchmarks)

<BenchmarkBars />

---

**ChadScript delivers compiled-language performance with TypeScript syntax:**

- **Matches C on matrix multiply** — 0.45s vs C's 0.45s on 512x512 dense matmul, faster than Go, 1.4x faster than Bun/Node
- **Faster than Go on recursion** — fib(42) in 1.7s vs Go's 1.81s, 2x faster than Bun, 3x faster than Node
- **1.7ms cold start** — within 13% of C, 2x faster than Go, 11x faster than Bun, 32x faster than Node
- **Near-C JSON** — 8ms to parse+stringify 10K objects via yyjson, 3x faster than Node, 4x faster than Go
- **Zero-overhead FFI** — calls C libraries directly, 71% of C's SQLite throughput, 1.9x faster than Bun, 2.4x faster than Node

Reproduce: `./benchmarks/run.sh` — Linux x86-64, single run, all runtimes on same machine.
