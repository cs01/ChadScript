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

Build CLI tools in TypeScript that run as **fast as C/Rust** with **instant startup** and **tiny binaries** (15-30KB). No Node.js runtime, no V8, no garbage collector. TypeScript compiles directly to native machine code via LLVM.

- 0ms startup (vs 50-200ms for Node.js)
- 15-30KB binaries (vs 50MB+ for bundled Node apps)
- Direct syscalls, no runtime overhead

## Quick Start

### Prerequisites

- **LLVM** (`llc`) - Compiler backend
- **C Compiler** - Clang or GCC
- **libcurl** - For `fetch()` support
- **libcjson** - For `JSON.parse<T>()`

```bash
# macOS
brew install llvm cjson
export PATH="/opt/homebrew/opt/llvm/bin:$PATH"

# Ubuntu/Debian
sudo apt-get install llvm clang libcurl4-openssl-dev libcjson-dev

# RHEL/Fedora
sudo dnf install llvm clang libcurl-devel cjson-devel
```

### Install & Use

```bash
npm install -g chadscript
chadscript hello.ts
./hello
```

### Compiler Options

```bash
chadscript [options] <input.ts> [output]

  -v, --verbose    Show compilation steps
  --debug          Show internal debugging information
  --trace          Show everything (AST, IR, variable tracking)
```

## What Works

**Core Language:** Functions, variables (`const`/`let`), operators, control flow (`if`/`while`/`for`), try/catch, ternary, classes with inheritance

**TypeScript:** Interfaces → native structs, type annotations, import/export modules

**Data Structures:** Arrays, Strings, Maps, Sets, Regex (with standard methods)

**Built-in APIs:** `console`, `process`, `fs`, `path`, `fetch`, `JSON.parse<T>`, `httpServe`, `async/await`, `Promise.all`, `setTimeout/setInterval`, POSIX sockets, `Math`

See `/examples/` for working code: CLI tools, HTTP servers, argument parsing, and more.

## Limitations

- **No npm packages yet** - Only local imports supported; `node_modules` resolution not implemented
- **No dynamic features** - No `eval`, `typeof`, `Object.keys()`, destructuring, spread, optional chaining
- **No reflection** - No `instanceof`, `for..in`, runtime type inspection
- **Nested if returns** - Deep nesting with early returns can generate invalid IR (extract to functions)

## Architecture

```
TypeScript → AST (with types) → LLVM IR → native binary (llc + clang)
```

## Roadmap

**Phase 2 Complete:** Interfaces, networking, classes, try/catch, async/await, HTTP server

**Phase 3 (Current):** Self-hosting (compile ChadScript with ChadScript)

## License

MIT
