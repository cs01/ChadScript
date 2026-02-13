# Benchmarks

ChadScript compiles to native ELF binaries via LLVM. No runtime, no JIT warmup, no cold start. [See details.](https://github.com/cs01/ChadScript/tree/main/benchmarks)

<BenchmarkBars />

---

**ChadScript delivers compiled-language performance with TypeScript syntax:**

- **Native HTTP server** — 120K req/sec hello-world, competitive with Go's net/http, 3x faster than Node.js
- **Native WebSocket** — 48K msg/sec broadcast with 32 clients, no framework overhead
- **1.9ms cold start** — within 19% of C, 2x faster than Go, 10x faster than Bun, 34x faster than Node
- **Ties C on compute** — matches C on 512×512 matrix multiply, beats Node.js on N-Body simulation
- **Zero-overhead FFI** — calls C libraries directly, 89% of C's SQLite throughput, 2.3x faster than Node/Bun

Reproduce: `./benchmarks/run.sh` — Linux x86-64, single run, all runtimes on same machine.
