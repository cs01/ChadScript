# ChadScript - Build Fast CLIs in TypeScript

**Write TypeScript, compile to native binaries. Performance like Rust/C++, syntax like TypeScript.**

```bash
$ npx tsx src/index.ts examples/hello.ts /tmp/hello

$ time /tmp/hello
Hello from ChadScript!
This is native code - no Node.js runtime!

real	0m0.008s

$ file /tmp/hello
/tmp/hello: ELF 64-bit LSB executable, x86-64, version 1 (SYSV), dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, for GNU/Linux 3.2.0, not stripped
```

## Why ChadScript?

Build CLI tools in TypeScript that run as **fast as C/Rust** with **instant startup** and **tiny binaries**. No Node.js runtime, no V8. TypeScript compiles directly to native machine code via LLVM.

Batteries included: links against battle-tested C libraries (libcurl, libcjson, libuv, mongoose) for production-grade HTTP client/server, JSON parsing, and async.

- ~10ms startup (vs 50-200ms for Node.js)
- ~300KB binaries (vs 50MB+ for bundled Node apps)
- Native code, no interpreter overhead

## Quick Start

### Prerequisites

- **LLVM** (`llc`) - Compiler backend
- **Clang or GCC** - Linker
- **libcurl, libcjson, libuv** - Runtime libraries
- **libgc** - [Boehm GC](https://github.com/ivmai/bdwgc)
- **mongoose** - [Embedded HTTP server](https://github.com/cesanta/mongoose) (compile `mongoose.c` to `mongoose.o`)

```bash
# macOS
brew install llvm cjson libuv
export PATH="/opt/homebrew/opt/llvm/bin:$PATH"

# Ubuntu/Debian
sudo apt-get install llvm clang libcurl4-openssl-dev libcjson-dev libuv1-dev libgc-dev

# RHEL/Fedora
sudo dnf install llvm clang libcurl-devel cjson-devel libuv-devel gc-devel
```

### Install & Use

```bash
# Build dependencies into vendor/
git clone https://github.com/ivmai/bdwgc vendor/bdwgc
cd vendor/bdwgc && ./autogen.sh && ./configure && make && cd ../..

git clone https://github.com/cesanta/mongoose vendor/mongoose
cc -c vendor/mongoose/mongoose.c -o vendor/mongoose/mongoose.o

# Compile and run
npx tsx src/index.ts examples/hello.ts ./hello
./hello
```

Or set environment variables to point to existing builds:
```bash
export CHADSCRIPT_BDWGC_PATH=/path/to/bdwgc    # Directory containing libgc.a or libgc.so
export CHADSCRIPT_MONGOOSE_PATH=/path/to/mongoose  # Directory containing mongoose.o
```

### Compiler Options

```bash
npx tsx src/index.ts [options] <input.ts> [output]

  -v, --verbose    Show compilation steps
  --debug          Show internal debugging information
  --trace          Show everything (AST, IR, variable tracking)
```

## What Works

**Core Language:** Functions, variables (`const`/`let`), operators, control flow (`if`/`while`/`for`/`for...of`), try/catch, ternary, classes with inheritance

**TypeScript:** Interfaces → native structs, type annotations, import/export modules, npm packages (with TS source)

**Data Structures:** Arrays, Strings, Maps, Sets, Regex (with standard methods)

**Built-in APIs:** `console`, `process`, `fs`, `path`, `fetch`, `JSON.parse<T>`, `httpServe`, `async/await`, `Promise.all`, `setTimeout/setInterval`, POSIX sockets, `Math`

See `/examples/` for working code: CLI tools, HTTP servers, argument parsing, and more.

## Limitations

- **No discriminated unions** - Each type maps to one LLVM representation (`string` → `i8*`, `number` → `double`). Unions like `string | null` work (same repr), but `string | number` is rejected at compile time because the compiler can't represent both in a single value slot. Tagged unions may be added in the future.
- **No dynamic features** - No `eval`, `typeof`, `Object.keys()`, destructuring, spread, optional chaining
- **No reflection** - No `instanceof`, `for..in`, runtime type inspection
- **Nested if returns** - Deep nesting with early returns can generate invalid IR (extract to functions)

## Architecture

```
TypeScript → AST (with types) → LLVM IR → native binary
```

Linked against: libgc (GC), libcurl (fetch), libcjson (JSON), libuv (async), mongoose (HTTP server)

## Roadmap

**Self-hosting:** Compile ChadScript with itself:
```bash
npx tsx src/index.ts src/native-compiler.ts /tmp/native-compiler
/tmp/native-compiler src/native-compiler.ts /tmp/self-hosted
```

**Native tsc:** Compile the TypeScript compiler to a native binary for instant type-checking.

## License

MIT
