# How ChadScript Works

ChadScript is an ahead-of-time compiler. It reads TypeScript source files, type-checks them, generates LLVM IR, and produces a standalone native binary. There's no interpreter, no JIT, and no runtime dependency on Node.js or V8.

## Compilation Pipeline

```
TypeScript source → parse → type-check → LLVM IR → assemble → link → native binary
```

When you run `chad build app.ts -o app`, the compiler:

1. **Parses** your TypeScript into an AST
2. **Resolves types** — every variable, parameter, and return value gets a concrete type
3. **Generates LLVM IR** — each function, class, and expression is lowered to LLVM intermediate representation
4. **Assembles** — `llc` converts the IR to a native object file
5. **Links** — `clang` links the object file against system libraries to produce the final binary

The output is a standard ELF binary (Linux) or Mach-O binary (macOS). You can run it, deploy it, or distribute it like any other compiled program.

## What's Inside the Binary

ChadScript links against several C libraries so your program has access to networking, databases, crypto, and more without installing anything at runtime:

| Library | What it provides |
|---------|-----------------|
| libgc (Boehm GC) | Automatic memory management |
| libuv | Event loop for async/await, timers |
| libcurl | HTTP client (`fetch()`) |
| libcrypto (OpenSSL) | Hashing, random bytes |
| libsqlite3 | SQLite database |
| mongoose | HTTP server (`httpServe()`) |
| cJSON | JSON parsing |

All of these are statically linked into your binary. The result is a single file with no external dependencies.

## Self-Hosting

ChadScript compiles itself. The compiler is ~45k lines of TypeScript that produces a native binary — which can then compile the compiler again without Node.js. This three-stage bootstrap (Node.js → Stage 0 → Stage 1 → Stage 2) is the ultimate correctness test: if the compiler's output can reproduce itself, it's working correctly.

## Platform Support

- **Linux x86-64** — primary target
- **macOS** — supported, including cross-compilation (`--target macos-arm64`, `--target linux-x64`)
