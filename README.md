# ChadScript

**[Documentation](https://cs01.github.io/ChadScript/)** · **[Benchmarks](https://cs01.github.io/ChadScript/benchmarks)** · **[GitHub Releases](https://github.com/cs01/ChadScript/releases)**

**A native compiler for TypeScript — no interpreter, no runtime, no VM.**

Your code goes through a full compilation pipeline: parse, type-check, emit LLVM IR, and link into a standalone native binary.

ChadScript is self-hosting - the compiler is written in TypeScript and compiles itself into a native binary that doesn't need any JavaScript runtime or Node.js.

## Demo

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

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/cs01/ChadScript/main/install.sh | sh
```

Requires LLVM (`brew install llvm` / `apt install llvm clang`).

## Documentation

Learn more at **[cs01.github.io/ChadScript](https://cs01.github.io/ChadScript/)**

## License

MIT
