# Benchmarks

ChadScript compiles to native ELF binaries via LLVM. No runtime, no JIT warmup, no cold start. [See details.](https://github.com/cs01/ChadScript/tree/main/benchmarks)

<BenchmarkBars />

---

**ChadScript delivers compiled-language performance with TypeScript syntax:**

- **Matches C on matrix multiply** — 0.457s vs C’s 0.430s on 512×512 dense matmul, 1.4x faster than Node
- **Faster than Go on recursion** — fib(42) in 1.49s vs Go’s 1.67s, 2x faster than Bun, 3x faster than Node
- **1.9ms cold start** — within 12% of C, 2x faster than Go, 10x faster than Bun, 28x faster than Node
- **Near-C JSON** — 8ms to parse+stringify 10K objects via yyjson, 2x faster than Node, 5x faster than Go
- **Zero-overhead FFI** — calls C libraries directly, 58% of C’s SQLite throughput, 1.5x faster than Bun, 1.9x faster than Node

Reproduce: `./benchmarks/run.sh` — Linux x86-64, single run, all runtimes on same machine.
