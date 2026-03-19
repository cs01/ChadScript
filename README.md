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

## Example: API server

```typescript
import { httpServe, Router, Context } from "chadscript/http";

const app: Router = new Router();

app.get("/", (c: Context) => {
  return c.html(`<html><body style="font-family:system-ui;max-width:600px;margin:40px auto">
    <h1>ChadScript API</h1>
    <p>A native binary serving this page. Try the endpoints:</p>
    <ul>
      <li><a href="/users/42">/users/42</a> — get user by ID</li>
      <li><a href="/users/alice/posts/7">/users/alice/posts/7</a> — nested params</li>
      <li><a href="/json">/json</a> — JSON response</li>
    </ul>
    <p><code>curl -X POST -d 'hello' localhost:3000/echo</code></p>
  </body></html>`);
});

app.get("/json", (c: Context) => {
  return c.json({ name: "ChadScript", compiled: true });
});

app.get("/users/:id", (c: Context) => {
  return c.json({ id: c.req.param("id") });
});

app.get("/users/:name/posts/:pid", (c: Context) => {
  return c.json({ user: c.req.param("name"), post: c.req.param("pid") });
});

app.post("/echo", (c: Context) => {
  return c.text(c.req.body);
});

httpServe(3000, (req: HttpRequest) => app.handle(req));
```

```bash
chad build app.ts && ./app   # compiles in ~0.3s, starts in <2ms
```

Hono-style API, C-level performance. One binary, no node_modules. See [`examples/`](examples/) for more: [weather app](examples/apps/weather/) (in production at [chadsmith.dev/weather](https://chadsmith.dev/weather)), [Hacker News clone](examples/apps/hackernews/), [WebSocket chat](examples/apps/websocket/), SQLite, and more.

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

chad run examples/snippets/hello.ts
chad run examples/snippets/parallel.ts          # async/await + Promise.all
chad run examples/snippets/sqlite-demo.ts       # SQLite
chad run examples/apps/http-server/app.ts       # http://localhost:3000
chad run examples/apps/weather/app.ts           # weather app — live at https://chadsmith.dev/weather
chad run examples/apps/hackernews/app.ts        # Hacker News clone
```

See [`examples/cli-tools/`](examples/cli-tools/) for a suite of Unix tool replacements: `cgrep`, `cwc`, `ccat`, `ctree`, `chex`, `cjq`, `cql`, `chttp`, and `cserve`.

---

## Docs

- [Installation](https://cs01.github.io/ChadScript/getting-started/installation)
- [Quickstart](https://cs01.github.io/ChadScript/getting-started/quickstart)
- [Supported Features](https://cs01.github.io/ChadScript/language/features)
- [Standard Library](https://cs01.github.io/ChadScript/stdlib/)
- [FAQ](https://cs01.github.io/ChadScript/faq)
