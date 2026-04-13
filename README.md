# ChadScript

TypeScript, compiled to native code.

ChadScript compiles a statically analyzable subset of TypeScript to native machine code via LLVM — the same backend behind C, Rust, and Swift. No VM, no interpreter, no runtime. The output is a standalone binary: sub-millisecond startup, ~250KB, zero dependencies.

The compiler is self-hosting and the only dependency is itself. Install with curl, not npm.

**Status: Beta** — self-hosting, 621+ tests, used in [production](https://chadsmith.dev/weather).

**[Docs](https://cs01.github.io/ChadScript/getting-started/installation)** · **[Standard Library](https://cs01.github.io/ChadScript/stdlib/)** · **[Language Features](https://cs01.github.io/ChadScript/language/features)** · **[Benchmarks](https://cs01.github.io/ChadScript/benchmarks)**

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

## Benchmarks

ChadScript compiles through LLVM, the same backend behind C and Rust — so it gets the same optimization passes. Compared against C, Go, and Node.js on Apple Silicon. **Median of N=10 runs**; full 95% bootstrap confidence intervals on the [benchmarks dashboard](https://cs01.github.io/ChadScript/benchmarks).

| Benchmark       | ChadScript | Node.js | vs Node  | C      |
| --------------- | ---------- | ------- | -------- | ------ |
| SQLite          | **0.079s** | 0.165s  | **2.1x** | 0.080s |
| JSON Parse      | **0.002s** | 0.004s  | **2.0x** | 0.002s |
| Monte Carlo Pi  | **0.264s** | 2.486s  | **9.4x** | 0.265s |
| Matrix Multiply | **0.109s** | 0.137s  | **1.3x** | 0.099s |
| Fibonacci       | **0.516s** | 1.502s  | **2.9x** | 0.442s |
| Sieve           | **0.012s** | 0.025s  | **2.1x** | 0.008s |
| Quicksort       | **0.140s** | 0.159s  | **1.1x** | 0.121s |
| N-Body Sim      | **0.824s** | 1.089s  | **1.3x** | 0.774s |
| File I/O        | **0.054s** | 0.072s  | **1.3x** | 0.027s |
| Binary Trees    | **0.604s** | 0.368s  | 0.6x     | 0.854s |
| Cold Start      | **5.9ms**  | 27.4ms  | **4.6x** | 6.8ms  |

**Statistically tied with C on 3 benchmarks** (SQLite, JSON, Monte Carlo — 95% CIs overlap). **Beats both C and Go on Binary Trees** — but loses to Node's V8 JIT which eliminates allocations via escape analysis. **Matches Go within 5% on Matrix Multiply, N-Body, Monte Carlo, and Sieve.**

---

## It's Fast

Your code goes through the same LLVM optimization passes as C and Rust — not a JIT, not an interpreter. Ties hand-written C on SQLite, JSON, and Monte Carlo. Native execution speed.

## It's Familiar

Classes, interfaces, generics, async/await, closures, destructuring, template literals, JSX, `for...of`, `Map`, `Set`, `Promise.all` — it's the TypeScript you already write. No new syntax, no new mental model.

## It's Friendly

No `npm install`. Everything ships with the compiler: HTTP server, SQLite, fetch, crypto, WebSocket, JSON, filesystem, regex, child processes, argument parsing. Write your code, compile it, ship a single binary.

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
