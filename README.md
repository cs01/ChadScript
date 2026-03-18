# ChadScript

As fast as C, as ergonomic as TypeScript.

ChadScript compiles TypeScript to native binaries. No Node.js, no V8, no runtime. Sub-2ms startup, ~250KB binaries.

The compiler is self-hosting and the only dependency is itself. Install with curl, not npm.

**Status: Beta** — self-hosting, 621+ tests, used in [production](https://chadsmith.dev/hn). Safe for early adopters.

---

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/cs01/ChadScript/main/install.sh | sh
```

No dependencies — everything is bundled in the compiler.

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
your-app.ts  →  chad build  →  ./your-app
```

Every type is resolved at compile time. The compiler optimizes your code the same way C and Rust compilers do. The output is a single native binary — run it, ship it, `scp` it, containerize it.

---

## Why TypeScript syntax?

TypeScript is familiar to millions of developers, and LLMs generate it fluently. ChadScript uses a statically-typed subset where every type is resolved at compile time — no `any`, no runtime type checks, no surprises:

- **Null safety** — `string` is never null. Use `string | null` and `?.` for optional values.
- **No manual memory management** — automatic garbage collection. No use-after-free, no double-frees.
- **Compile-time error catching** — type mismatches, invalid method calls, and unsafe patterns are caught before your code runs.
- **C interop** — call any C library directly with `declare function`. No wrappers, no overhead.
- **IDE support** — `chad init` generates `tsconfig.json` with ChadScript types. VS Code works out of the box.

---

## What's included

No `npm install`. Everything ships with the compiler:

| Module                | What it does             |
| --------------------- | ------------------------ |
| `fetch`               | HTTP client              |
| `Router`, `httpServe` | HTTP server with routing |
| `fs`                  | File system              |
| `sqlite`              | Embedded database        |
| `crypto`              | Hashing, random bytes    |
| `JSON`                | Typed parse/stringify    |
| `child_process`       | Spawn subprocesses       |
| `WebSocket`           | WebSocket server         |
| `Map`, `Set`          | Hash map and set         |
| `RegExp`              | Regular expressions      |
| `console`             | Prints any type          |
| `ArgumentParser`      | CLI argument parsing     |

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
