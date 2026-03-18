# ChadScript

As fast as C, as ergonomic as TypeScript.

ChadScript compiles TypeScript to native binaries. No Node.js, no V8, no runtime. Sub-2ms startup, ~250KB binaries.

The compiler is self-hosting and the only dependency is itself. Install with curl, not npm.

**Status: Beta** — self-hosting, 621+ tests, used in [production](https://chadsmith.dev/weather).

---

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/cs01/ChadScript/main/install.sh | sh
```

No dependencies — everything is bundled in the compiler.

---

## Example: JSON API in 20 lines

```typescript
import { httpServe, Router, Context } from "chadscript/http";

const app: Router = new Router();

app.get("/", (c: Context) => {
  return c.json({ name: "ChadScript API", version: "1.0.0" });
});

app.get("/users/:id", (c: Context) => {
  const id = c.req.param("id");
  return c.json({ id, name: "User " + id });
});

app.post("/echo", (c: Context) => {
  return c.text(c.req.body);
});

app.notFound((c: Context) => {
  return c.status(404).json({ error: "not found" });
});

httpServe(3000, (req: HttpRequest) => app.handle(req));
```

```bash
chad build app.ts && ./app   # compiles in ~0.3s, starts in <2ms
```

One binary. No node_modules. Express-style routing. See [`examples/`](examples/) for more: [weather app](examples/weather/), [Hacker News clone](examples/hackernews/), [WebSocket chat](examples/websocket/), SQLite, and more.

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
chad run examples/weather/app.ts       # weather app — live at https://chadsmith.dev/weather
chad run examples/hackernews/app.ts    # Hacker News clone
```

See [`examples/`](examples/) for the full list: grep tool, word counter, WebSocket chat, TUI apps, and more.

---

## Docs

- [Installation](https://cs01.github.io/ChadScript/getting-started/installation)
- [Quickstart](https://cs01.github.io/ChadScript/getting-started/quickstart)
- [Supported Features](https://cs01.github.io/ChadScript/language/features)
- [Standard Library](https://cs01.github.io/ChadScript/stdlib/)
- [FAQ](https://cs01.github.io/ChadScript/faq)
