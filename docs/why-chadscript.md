# What is ChadScript?

ChadScript is an ahead-of-time compiler for a TypeScript-like language. Write TypeScript-style code, run `chad build`, and get a standalone native binary — no Node.js, no runtime.

## Key characteristics

- **TypeScript syntax** — classes, interfaces, async/await, closures, template literals, destructuring. If you write TypeScript, the syntax is immediately familiar.
- **Native compilation via LLVM** — produces ELF binaries on Linux and Mach-O binaries on macOS. Startup is typically sub-2ms.
- **Batteries included** — HTTP, SQLite, fetch, crypto, JSON, filesystem — all built in, backed by proven C libraries.
- **Single-binary deploy** — `chad build app.ts -o app` produces one self-contained file you can copy anywhere.
- **Self-hosting** — the compiler is written in ChadScript and compiles itself to a native binary.

## What ChadScript is not

ChadScript is a practical, statically-typed subset of TypeScript. It is not a full TypeScript compiler. There is no `any`, no `eval`, no runtime type inspection, no dynamic imports. Most npm packages won't work. If you need full npm compatibility or dynamic JavaScript features, use Node, Bun, or Deno.

## See it in production

[chadsmith.dev/hn](https://chadsmith.dev/hn) is a live Hacker News clone running as a ChadScript binary — SQLite database, HTTP server, and embedded HTML/CSS/JS assets, shipped as a single file.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/cs01/ChadScript/main/install.sh | sh
```

## First steps

- [Installation](/getting-started/installation)
- [Quickstart](/getting-started/quickstart)
- [Supported features](/language/features)
