# Quickstart

## Hello World

```typescript
console.log("Hello from ChadScript!");
```

```bash
chad run hello.ts
# or compile to a standalone binary:
chad build hello.ts -o hello && ./hello
```

## More Examples

The [`examples/`](https://github.com/cs01/ChadScript/tree/main/examples) directory contains runnable programs covering common use cases. Clone the repo and run any of them with `chad run`:

**CLI Tools** — Unix tool replacements in [`examples/cli-tools/`](https://github.com/cs01/ChadScript/tree/main/examples/cli-tools):

| Tool | Description |
|------|-------------|
| [`cgrep`](https://github.com/cs01/ChadScript/blob/main/examples/cli-tools/cgrep.ts) | grep-like search with colorized output |
| [`cwc`](https://github.com/cs01/ChadScript/blob/main/examples/cli-tools/cwc.ts) | Line/word/char counter (like `wc`) |
| [`ccat`](https://github.com/cs01/ChadScript/blob/main/examples/cli-tools/ccat.ts) | File viewer with syntax highlighting (like `bat`) |
| [`ctree`](https://github.com/cs01/ChadScript/blob/main/examples/cli-tools/ctree.ts) | Directory tree printer (like `tree`) |
| [`chex`](https://github.com/cs01/ChadScript/blob/main/examples/cli-tools/chex.ts) | Hex dump viewer (like `xxd`) |
| [`cjq`](https://github.com/cs01/ChadScript/blob/main/examples/cli-tools/cjq.ts) | JSON query tool (like `jq`) |
| [`cql`](https://github.com/cs01/ChadScript/blob/main/examples/cli-tools/cql.ts) | SQL queries on CSV files (powered by SQLite) |
| [`chttp`](https://github.com/cs01/ChadScript/blob/main/examples/cli-tools/chttp.ts) | HTTP client (like `curl`) |
| [`cserve`](https://github.com/cs01/ChadScript/blob/main/examples/cli-tools/cserve.ts) | Static file server |

**Apps** — full applications in [`examples/apps/`](https://github.com/cs01/ChadScript/tree/main/examples/apps):

| App | Description |
|-----|-------------|
| [`hackernews`](https://github.com/cs01/ChadScript/tree/main/examples/apps/hackernews) | Full Hacker News clone — SQLite + embedded assets + JSON API |
| [`weather`](https://github.com/cs01/ChadScript/tree/main/examples/apps/weather) | Weather app — live at [chadsmith.dev/weather](https://chadsmith.dev/weather) |
| [`http-server`](https://github.com/cs01/ChadScript/tree/main/examples/apps/http-server) | HTTP server with Express-like routing |
| [`websocket`](https://github.com/cs01/ChadScript/tree/main/examples/apps/websocket) | WebSocket chat with embedded HTML/CSS |

**Snippets** — small feature demos in [`examples/snippets/`](https://github.com/cs01/ChadScript/tree/main/examples/snippets):

| Snippet | Description |
|---------|-------------|
| [`hello.ts`](https://github.com/cs01/ChadScript/blob/main/examples/snippets/hello.ts) | Hello World — native execution, no runtime |
| [`parallel.ts`](https://github.com/cs01/ChadScript/blob/main/examples/snippets/parallel.ts) | Parallel HTTP fetches with `async/await` + `Promise.all` |
| [`sqlite-demo.ts`](https://github.com/cs01/ChadScript/blob/main/examples/snippets/sqlite-demo.ts) | SQLite database operations |
| [`timers.ts`](https://github.com/cs01/ChadScript/blob/main/examples/snippets/timers.ts) | `setTimeout`/`setInterval` with the libuv event loop |

```bash
git clone https://github.com/cs01/ChadScript && cd ChadScript

chad run examples/snippets/hello.ts
chad run examples/snippets/parallel.ts
chad run examples/snippets/sqlite-demo.ts
chad run examples/apps/http-server/app.ts       # http://localhost:3000
chad run examples/apps/hackernews/app.ts        # http://localhost:3000
```

## Next Steps

- Browse the [Standard Library](/stdlib/) for all available APIs
- See [CLI Reference](/getting-started/cli) for all compiler options
- Check [Supported Features](/language/features) to understand the TypeScript subset
