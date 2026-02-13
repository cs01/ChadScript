---
layout: home
hero:
  name: ChadScript
  text: TypeScript to Native Binaries
  tagline: "Compile high-speed apps directly: from TypeScript to native binaries via LLVM. No runtime."
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/installation
    - theme: alt
      text: API Reference
      link: /stdlib/
    - theme: alt
      text: GitHub
      link: https://github.com/cs01/ChadScript

features:
  - title: No Runtime
    details: No Node.js, no V8, no interpreter. The output is a standalone ELF binary that starts in under 10ms.
  - title: Familiar Syntax
    details: Write the TypeScript you already know. Classes, interfaces, async/await, generics - it all works.
  - title: Self-Hosting
    details: ChadScript compiles itself. The compiler is ~45k lines of TypeScript that compiles to a native binary - no Node.js needed.
  - title: Batteries Included
    details: HTTP servers, file I/O, JSON, crypto, SQLite, regex, async - all compiled to native code. No npm required.
---

<HeroRotator />

## Quick Demo

```bash
$ chad build examples/hello.ts -o /tmp/hello

$ time /tmp/hello
Hello from ChadScript!
This is native code - no Node.js runtime!

real	0m0.008s

$ file /tmp/hello
/tmp/hello: ELF 64-bit LSB executable, x86-64
```

## Why ChadScript?

**vs Node.js / Deno / Bun**: No runtime, no `node_modules`, no cold start penalty. Ship a single binary.

**vs Rust / C / C++**: You already know the syntax. No borrow checker, no header files, no makefiles.

**vs Go**: TypeScript syntax instead of Go's idiosyncratic type system. Classes, generics, interfaces, and async/await work the way you expect.

ChadScript is not a drop-in replacement for TypeScript - it's a compiled language that uses TypeScript syntax.
