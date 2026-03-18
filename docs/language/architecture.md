# How It Works

ChadScript is an ahead-of-time compiler that produces standalone native binaries. The compiler is self-hosting: written in ChadScript, compiled by ChadScript, verified in a 3-stage bootstrap.

## Compilation Pipeline

When you run `chad build app.ts -o app`, the compiler:

1. Parses your TypeScript into an AST (Tree-sitter grammar)
2. Resolves every type — all types must be known at compile time
3. Runs semantic checks (null safety, closure safety, type validation)
4. Lowers the AST to [LLVM IR](https://llvm.org/docs/LangRef.html) — the same intermediate format used by Clang, Rust, and Swift
5. Optimizes with LLVM `-O2` — loop vectorization, inlining, constant folding, dead code elimination
6. Links to a native binary via the embedded LLD linker

The output is a standard ELF binary (Linux) or Mach-O binary (macOS). No runtime, no interpreter, no JIT. Types map directly to machine types — `number` is a 64-bit double, `string` is a pointer, structs are contiguous memory.

## Memory Management

ChadScript programs use the [Boehm GC](https://www.hboehm.info/gc/) (`libgc`), a conservative garbage collector used in production by Mono, GCJ, and Guile. All heap allocations go through `GC_malloc`. No manual memory management, no use-after-free, no double-frees.

## Platform Support

| Platform | Status |
|----------|--------|
| Linux x86-64 | Primary target |
| Linux ARM64 | Supported |
| macOS ARM64 | Supported (Apple Silicon) |
| macOS x64 | Supported (Intel) |

Cross-compilation is supported via `--target` — see the [CLI reference](/getting-started/cli#cross-compilation) for details.
