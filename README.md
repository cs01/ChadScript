# ChadScript

**Compile High-Performance Apps Directly from TypeScript to native binaries that run as fast as C.**

```bash
$ chad build examples/hello.ts -o /tmp/hello
$ time /tmp/hello
Hello from ChadScript!
This is native code - no Node.js runtime!

real	0m0.001s
```

ChadScript is self-hosting — the compiler is written in TypeScript and compiles itself into a native binary that needs no Node.js runtime.

## Why ChadScript?

- **vs Node.js / Deno / Bun** — No runtime, no `node_modules`, no cold start. Ship a single binary that starts in under 2ms.
- **vs Rust / C / C++** — You already know the syntax. No borrow checker, no header files, no makefiles.
- **vs Go** — TypeScript syntax instead of Go's idiosyncratic type system. Classes, generics, interfaces, and async/await work the way you expect.

ChadScript is not a drop-in replacement for TypeScript — it's a compiled language that uses TypeScript syntax.

## Quick Start

```bash
# Install dependencies (Ubuntu/Debian)
sudo apt-get install llvm clang libcurl4-openssl-dev libssl-dev libsqlite3-dev

# Download from GitHub Releases, then:
chad run hello.ts
```

Or compile to a binary:

```bash
chad build hello.ts -o hello
./hello
```

**macOS users**: If you get a security warning, run `xattr -d com.apple.quarantine /path/to/chad` to bypass Gatekeeper.

To build from source, see [BUILDING.md](BUILDING.md).

## Documentation

Full API reference, stdlib docs, and language guide: **[cs01.github.io/ChadScript](https://cs01.github.io/ChadScript/)**

## License

MIT
