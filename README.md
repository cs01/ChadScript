# ChadScript

**A native compiler for TypeScript — no interpreter, no runtime, no VM.**

Your code goes through a full compilation pipeline: parse, type-check, emit LLVM IR, and link into a standalone native binary.

**[Documentation](https://cs01.github.io/ChadScript/)** · **[Benchmarks](https://cs01.github.io/ChadScript/benchmarks)** · **[GitHub Releases](https://github.com/cs01/ChadScript/releases)**

## Install

Download the latest binary from [GitHub Releases](https://github.com/cs01/ChadScript/releases) and add it to your PATH.

You'll also need LLVM and a few system libraries:

```bash
# Ubuntu / Debian
sudo apt-get install llvm clang libcurl4-openssl-dev libssl-dev libsqlite3-dev

# macOS
brew install llvm openssl sqlite
```

## Get Started

```bash
chad init
```

This creates a `hello.ts` starter file and sets up type definitions for your editor:

```ts
// hello.ts
console.log("Hello from ChadScript!");
```

Run it:

```bash
$ chad run hello.ts
Hello from ChadScript!
```

Or compile to a standalone binary:

```bash
chad build hello.ts -o hello
./hello
```

ChadScript is self-hosting — the compiler is written in TypeScript and compiles itself into a native binary that needs no Node.js runtime.

## Documentation

Full API reference, stdlib docs, and language guide: **[cs01.github.io/ChadScript](https://cs01.github.io/ChadScript/)**

To build from source, see [BUILDING.md](BUILDING.md).

## License

MIT
