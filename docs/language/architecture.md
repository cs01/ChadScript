# How It Works

ChadScript is an ahead-of-time compiler that produces standalone native binaries. The compiler is self-hosting: it is written in TypeScript and compiles itself to a native binary.

## Compilation Pipeline

When you run `chad build app.ts -o app`, the compiler:

1. Parses your TypeScript into an AST
2. Resolves every type (all types must be known at compile time)
3. Lowers the AST to [LLVM IR](https://llvm.org/docs/LangRef.html) — the same intermediate format used by Clang, Rust, and Swift
4. Compiles and optimizes to object code (`clang -O2`)
5. Links to a native binary (`clang`)

The output is a standard ELF binary (Linux) or Mach-O binary (macOS) that runs with no runtime.

## Memory Management

ChadScript programs use the [Boehm GC](https://www.hboehm.info/gc/) (`libgc`), a conservative garbage collector. All heap allocations go through `GC_malloc`. You don't need to manage memory manually.

## Platform Support

| Platform | Status |
|----------|--------|
| Linux x86-64 | Primary target |
| Linux ARM64 | Supported |
| macOS ARM64 | Supported (Apple Silicon) |
| macOS x64 | Supported (Intel) |

Cross-compilation is supported via `--target` — see the [CLI reference](/getting-started/cli#cross-compilation) for details.
