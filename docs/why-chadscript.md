# What is ChadScript?

ChadScript compiles TypeScript to native binaries. Write TypeScript, run `chad build`, get a standalone executable — no Node.js, no runtime, no cold start.

## Key characteristics

- **TypeScript syntax** — classes, interfaces, generics, async/await, closures, destructuring, JSX. If you write TypeScript, you already know ChadScript.
- **Native compilation** — compiles to optimized machine code with the same optimization passes used by C and Rust compilers. Sub-2ms startup, ~250KB binaries.
- **No dependencies** — install with `curl`, not `npm`. Everything is bundled in the compiler.
- **Batteries included** — HTTP server, SQLite, fetch, crypto, WebSocket, JSON, filesystem — all built in. No packages to install.
- **Single-binary deploy** — `chad build app.ts -o app` produces one self-contained file. Copy it to a server, drop it in a container, run it.
- **Self-hosting** — the compiler is written in ChadScript and compiles itself.

## What ChadScript is not

ChadScript is a statically-typed subset of TypeScript designed for native compilation. It is not a JavaScript runtime. There is no `any`, no `eval`, no runtime type inspection, no dynamic imports. npm packages won't work unless rewritten in the ChadScript subset. If you need full Node.js compatibility, use Node, Bun, or Deno. ChadScript is for when you want a native binary.

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
