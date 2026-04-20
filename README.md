# ChadScript

> *Funny name. Serious performance.*

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

| Benchmark           | ChadScript | Node.js | vs Node  | C      |
| ------------------- | ---------- | ------- | -------- | ------ |
| SQLite              | **0.076s** | 0.169s  | **2.2x** | 0.083s |
| JSON Parse          | **0.002s** | 0.004s  | **2.0x** | 0.002s |
| String Manipulation | **0.007s** | 0.012s  | **1.7x** | 0.006s |
| Cold Start          | **5.8ms**  | 28.9ms  | **5.0x** | 6.7ms  |
| Monte Carlo Pi      | **0.279s** | 2.564s  | **9.2x** | 0.279s |
| Sieve               | **0.012s** | 0.026s  | **2.1x** | 0.008s |
| Fibonacci           | **0.542s** | 1.518s  | **2.8x** | 0.449s |
| String Search       | **0.008s** | 0.011s  | **1.4x** | 0.005s |
| Matrix Multiply     | **0.116s** | 0.138s  | **1.2x** | 0.106s |
| Quicksort           | **0.141s** | 0.160s  | **1.1x** | 0.130s |
| N-Body Sim          | **0.825s** | 1.096s  | **1.3x** | 0.777s |
| File I/O            | **0.055s** | 0.070s  | **1.3x** | 0.027s |
| Binary Trees        | **0.609s** | 0.372s  | 0.6x     | 0.880s |

**🥇 on 4 benchmarks** (SQLite, JSON, String Manipulation, Cold Start — all statsig tied with or beating C via 95% CI overlap). **Beats Node on every benchmark except Binary Trees**, where V8's JIT eliminates allocations via escape analysis. **Matches Go within 5% on Matrix Multiply, N-Body, Monte Carlo, and Sieve.**

---

## It's Fast

Your code goes through the same LLVM optimization passes as C and Rust — not a JIT, not an interpreter. The optimizations a JIT does at runtime, ChadScript does at compile time — with no startup tax. Ties hand-written C on SQLite, JSON, and Monte Carlo. Native execution speed.

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
