# ChadScript

ChadScript's goal:

> As fast as C, as safe as Rust, as ergonomic as TypeScript.

ChadScript is a natively-compiled systems language with TypeScript syntax. Write familiar TypeScript, run `chad build`, get a standalone ELF or Mach-O binary via LLVM — no Node.js, no JVM, no runtime.

The compiler is self-hosting: tens of thousands of lines of TypeScript that compile itself to a native binary. You install it with curl, not npm.

> Status: **Alpha** — usable and self-hosting, but expect crashes. Compiler warnings need improvement and more strictness.
>
> | Milestone                           | Status      |
> | ----------------------------------- | ----------- |
> | Proof of concept                    | ✅          |
> | Standard library + external linking | ✅          |
> | Self-hosting                        | ✅          |
> | Performance improvements            | ✅          |
> | Testing & hardening                 | In progress |
> | GC → Reference Counting             | Planned     |

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
  return c.json(JSON.stringify(posts));
});

app.get("/api/posts/:id", (c: Context) => {
  const id = c.req.param("id");
  return c.json('{"id":' + id + "}");
});

httpServe(3000, (req: HttpRequest) => app.handle(req));
```

```bash
chad build server.ts -o server
./server   # starts as fast as ~2ms, no node_modules, no runtime
```

---

## How it works

```
your-app.ts  →  ChadScript parser  →  AST  →  LLVM IR  →  opt  →  llc  →  clang  →  ./your-app
```

The same LLVM backend used by Clang, Rust, and Swift. Direct calls into C libraries — SQLite, libcurl, openssl — with zero FFI overhead. The output is a standard native binary: run it, ship it, containerize it.

---

## Why TypeScript syntax?

TypeScript is my favorite language to write and the type system is terse and intuitive. It's familiar to tens of millions of developers and LLMs are well trained on it. ChadScript uses a statically-safe subset where every type is known at compile time, enabling:

- **Null safety** — `string` is never null. Use `string | null` to express optional values and `?.` for safe access.
- **GC-managed memory** — Boehm GC handles allocation; no use-after-free or double-frees.
- **IDE support** — run `chad init` to get `tsconfig.json` pointing at ChadScript types and standard library. Language services in VS Code work.

---

## Batteries included

No `npm install`. Everything ships with the compiler:

| Module                | What it does               |
| --------------------- | -------------------------- |
| `fetch`               | HTTP client                |
| `Router`, `httpServe` | HTTP server with routing   |
| `fs`                  | File system                |
| `sqlite`              | Embedded SQLite database   |
| `crypto`              | Hashing, random bytes      |
| `JSON`                | Typed JSON parse/stringify |
| `child_process`       | Spawn subprocesses         |
| `WebSocket`           | WebSocket server           |

---

## Examples

```bash
git clone https://github.com/cs01/ChadScript && cd ChadScript

chad run examples/hello.ts
chad run examples/parallel.ts          # async/await + Promise.all
chad run examples/query.ts             # SQLite
chad run examples/http-server.ts       # http://localhost:3000
chad run examples/hackernews/app.ts    # Hacker News clone, single binary — live at https://chadsmith.dev/hn
```

---

## Docs

- [Installation](https://cs01.github.io/ChadScript/getting-started/installation)
- [Quickstart](https://cs01.github.io/ChadScript/getting-started/quickstart)
- [Supported Features](https://cs01.github.io/ChadScript/language/features)
- [Standard Library](https://cs01.github.io/ChadScript/stdlib/)
- [FAQ](https://cs01.github.io/ChadScript/faq)
