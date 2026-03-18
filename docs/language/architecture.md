# How It Works

ChadScript is an ahead-of-time compiler that produces standalone native binaries. The compiler is self-hosting: written in ChadScript, compiled by ChadScript, verified in a 3-stage bootstrap.

## Compilation Pipeline

When you run `chad build app.ts -o app`, the compiler:

1. Parses your TypeScript into an AST
2. Resolves every type — all types must be known at compile time
3. Runs semantic checks (null safety, closure safety, type validation)
4. Generates optimized machine code (using [LLVM](https://llvm.org/docs/LangRef.html) internally — the same optimization engine behind C and Rust compilers)
5. Links everything into a single native binary

The output is a standard native binary for your platform. No runtime, no interpreter, no JIT. Types map directly to machine types — `number` is a 64-bit double, `string` is a pointer, structs are contiguous memory.

## Memory Management

Memory is managed automatically by a garbage collector. You allocate freely — no `malloc`/`free`, no ownership annotations, no use-after-free. Under the hood, ChadScript uses the [Boehm GC](https://www.hboehm.info/gc/), a proven collector also used by Mono and GCJ.

## Platform Support

| Platform | Status |
|----------|--------|
| Linux x86-64 | Primary target |
| Linux ARM64 | Supported |
| macOS ARM64 | Supported (Apple Silicon) |
| macOS x64 | Supported (Intel) |

Cross-compilation is supported via `--target` — see the [CLI reference](/getting-started/cli#cross-compilation) for details.
