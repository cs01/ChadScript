# ChadScript

**[Documentation](https://cs01.github.io/ChadScript/)** · **[Benchmarks](https://cs01.github.io/ChadScript/benchmarks)** · **[GitHub Releases](https://github.com/cs01/ChadScript/releases)**

**As typesafe as Rust. As fast as C. As ergonomic as TypeScript.**

ChadScript is a systems programming language that uses TypeScript syntax and compiles directly to native binaries via LLVM. It is **not** a full TypeScript compiler — it's a statically-typed, natively-compiled dialect that shares TypeScript's syntax and feel while imposing stricter rules needed for native code (no generics, by-value closures, no `any`).

Your code goes through a full compilation pipeline: parse, type-check, emit LLVM IR, and link into a standalone native binary with no Node.js, V8, or JavaScript runtime.

ChadScript is self-hosting — the compiler (~45k lines) is written in this same dialect and compiles itself to a native binary.

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
