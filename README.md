# ChadScript - Build Fast CLIs in TypeScript

**Write TypeScript, compile to native binaries. Performance like Rust/C++, syntax like TypeScript.**

```bash
$ npx tsx src/index.ts examples/hello.ts /tmp/hello
$ time /tmp/hello
Hello from ChadScript!
This is native code - no Node.js runtime!

real	0m0.008s
```

## Why ChadScript?

Build CLI tools in TypeScript that run as **fast as C/Rust** with **instant startup** and **tiny binaries**. No Node.js runtime, no V8. TypeScript compiles directly to native machine code via LLVM.

Batteries included: links against battle-tested C libraries (libcurl, libcjson, libuv, mongoose) for production-grade HTTP client/server, JSON parsing, and async.

- 0ms startup (vs 50-200ms for Node.js)
- 15-30KB binaries (vs 50MB+ for bundled Node apps)
- Direct syscalls, no runtime overhead

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
git clone https://github.com/chadsmith/chadscript
cd chadscript
npm install
npx tsx src/index.ts examples/hello.ts ./hello
./hello
```

**Note:** Library paths are currently hardcoded in `src/compiler.ts`. You'll need to build [bdwgc](https://github.com/ivmai/bdwgc) and [mongoose](https://github.com/cesanta/mongoose) from source and update the paths.

### Compiler Options

```bash
npx tsx src/index.ts [options] <input.ts> [output]

  -v, --verbose    Show compilation steps
  --debug          Show internal debugging information
  --trace          Show everything (AST, IR, variable tracking)
```

## What Works

**Core Language:** Functions, variables (`const`/`let`), operators, control flow (`if`/`while`/`for`), try/catch, ternary, classes with inheritance

**TypeScript:** Interfaces → native structs, type annotations, import/export modules, npm packages (with TS source)

**Data Structures:** Arrays, Strings, Maps, Sets, Regex (with standard methods)

**Built-in APIs:** `console`, `process`, `fs`, `path`, `fetch`, `JSON.parse<T>`, `httpServe`, `async/await`, `Promise.all`, `setTimeout/setInterval`, POSIX sockets, `Math`

See `/examples/` for working code: CLI tools, HTTP servers, argument parsing, and more.

## Limitations

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
