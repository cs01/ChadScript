# ChadScript

> As fast as C, as ergonomic as TypeScript.

ChadScript is a natively-compiled systems language with TypeScript syntax. Write familiar TypeScript, run `chad build`, get a standalone ELF or Mach-O binary via LLVM — no Node.js, no JVM, no runtime.

The compiler is self-hosting: tens of thousands of lines of TypeScript that compile themselves to a native binary. You install it with curl, not npm.

> Status: **Alpha** — self-hosting and usable for real projects. The compiler catches type mismatches at compile time instead of crashing at runtime.
>
> | Milestone                           | Status |
> | ----------------------------------- | ------ |
> | Proof of concept                    | Done   |
> | Standard library + external linking | Done   |
> | Self-hosting (3-stage)              | Done   |
> | Performance (LLVM -O2)              | Done   |
> | Testing (470+ tests, CI)            | Done   |
> | Compile-time error coverage         | Done   |

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
your-app.ts  →  ChadScript parser  →  AST  →  LLVM IR  →  opt  →  llc  →  clang  →  ./your-app
```

The same LLVM backend used by Clang, Rust, and Swift. Direct calls into C libraries — SQLite, libcurl, openssl — with zero FFI overhead. The output is a standard native binary: run it, ship it, containerize it.

---

## Why TypeScript syntax?

TypeScript is familiar to tens of millions of developers, and LLMs are well-trained on it. ChadScript uses a statically-safe subset where every type is known at compile time:

- **Null safety** — `string` is never null. Use `string | null` and `?.` for optional values.
- **GC-managed memory** — Boehm GC handles allocation. No use-after-free, no double-frees.
- **Compile-time checks** — type mismatches, invalid method calls, and unsafe patterns are caught before your code runs.
- **IDE support** — `chad init` generates `tsconfig.json` with ChadScript types. VS Code language services work out of the box.

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
