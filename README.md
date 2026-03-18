# ChadScript

As fast as C, as ergonomic as TypeScript.

ChadScript compiles TypeScript to native binaries via LLVM — the same backend behind Clang, Rust, and Swift. No Node.js, no JVM, no runtime, no cold start. Sub-2ms startup, ~250KB binaries.

The compiler is self-hosting: written in ChadScript, compiled by ChadScript, verified in a 3-stage bootstrap. Install with curl, not npm.

**Status: Beta** — self-hosting, 621+ tests, used in [production](https://chadsmith.dev/hn). Safe for early adopters.

---

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/cs01/ChadScript/main/install.sh | sh
```

Requires LLVM (`brew install llvm` / `apt install llvm clang`).

---

## Example: HTTP server in a single binary

```typescript
import { httpServe, Router, Context } from "chadscript/http";

type Post = {
  id: number;
  title: string;
};

const posts: Post[] = [
  { id: 1, title: "ChadScript ships v1" },
  { id: 2, title: "Native speed, TypeScript syntax" },
];

const app: Router = new Router();

app.get("/api/posts", (c: Context) => {
  return c.json(posts);
});

app.get("/api/posts/:id", (c: Context) => {
  const id = c.req.param("id");
  return c.json({ id });
});

httpServe(3000, (req: HttpRequest) => app.handle(req));
```

---

## How it works

```
your-app.ts  →  ChadScript parser  →  AST  →  LLVM IR  →  clang  →  ./your-app
```

Every type is resolved at compile time. LLVM optimizes your code with the same passes used by C and Rust compilers — loop vectorization, inlining, dead code elimination. Direct calls into C libraries (SQLite, libcurl, openssl) with zero FFI overhead. The output is a standard native binary: run it, ship it, `scp` it, containerize it.

---

## Why TypeScript syntax?

TypeScript is familiar to millions of developers, and LLMs generate it fluently. ChadScript uses a statically-typed subset where every type is resolved at compile time — no `any`, no runtime type checks, no surprises:

- **Null safety** — `string` is never null. Use `string | null` and `?.` for optional values.
- **No manual memory management** — Boehm GC handles allocation. No use-after-free, no double-frees, no `malloc`/`free`.
- **Compile-time error catching** — type mismatches, invalid method calls, and unsafe patterns are caught before your code runs.
- **Zero-cost C interop** — `declare function` binds any C library directly. No wrappers, no marshalling.
- **IDE support** — `chad init` generates `tsconfig.json` with ChadScript types. VS Code works out of the box.

---

## What's included

No `npm install`. Everything ships with the compiler:

| Module                | What it does               |
| --------------------- | -------------------------- |
| `fetch`               | HTTP client (libcurl)      |
| `Router`, `httpServe` | HTTP server with routing   |
| `fs`                  | File system                |
| `sqlite`              | Embedded SQLite database   |
| `crypto`              | Hashing, random bytes      |
| `JSON`                | Typed JSON parse/stringify |
| `child_process`       | Spawn subprocesses         |
| `WebSocket`           | WebSocket server           |
| `Map`, `Set`          | Hash map and set           |
| `RegExp`              | Regular expressions        |
| `console`             | Prints any type correctly  |
| `ArgumentParser`      | CLI argument parsing       |

---

## Examples

```bash
git clone https://github.com/cs01/ChadScript && cd ChadScript

chad run examples/hello.ts
chad run examples/parallel.ts          # async/await + Promise.all
chad run examples/query.ts             # SQLite
chad run examples/http-server.ts       # http://localhost:3000
chad run examples/hackernews/app.ts    # Hacker News clone — live at https://chadsmith.dev/hn
```

See [`examples/`](examples/) for the full list: grep tool, word counter, WebSocket chat, TUI apps, and more.

---

## Docs

- [Installation](https://cs01.github.io/ChadScript/getting-started/installation)
- [Quickstart](https://cs01.github.io/ChadScript/getting-started/quickstart)
- [Supported Features](https://cs01.github.io/ChadScript/language/features)
- [Standard Library](https://cs01.github.io/ChadScript/stdlib/)
- [FAQ](https://cs01.github.io/ChadScript/faq)
