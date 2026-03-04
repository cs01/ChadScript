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

| Example | Description |
|---------|-------------|
| [`hello.ts`](https://github.com/cs01/ChadScript/blob/main/examples/hello.ts) | Hello World — native execution, no runtime |
| [`word-count.ts`](https://github.com/cs01/ChadScript/blob/main/examples/word-count.ts) | File line/word/char counter (like `wc`) |
| [`parallel.ts`](https://github.com/cs01/ChadScript/blob/main/examples/parallel.ts) | Parallel HTTP fetches with `async/await` + `Promise.all` |
| [`query.ts`](https://github.com/cs01/ChadScript/blob/main/examples/query.ts) | SQLite database operations |
| [`http-server.ts`](https://github.com/cs01/ChadScript/blob/main/examples/http-server.ts) | HTTP server with Express-like routing |
| [`string-search.ts`](https://github.com/cs01/ChadScript/blob/main/examples/string-search.ts) | grep-like search with colorized output |
| [`timers.ts`](https://github.com/cs01/ChadScript/blob/main/examples/timers.ts) | `setTimeout`/`setInterval` with the libuv event loop |
| [`cli-parser-demo.ts`](https://github.com/cs01/ChadScript/blob/main/examples/cli-parser-demo.ts) | CLI argument parsing |
| [`websocket/app.ts`](https://github.com/cs01/ChadScript/blob/main/examples/websocket) | WebSocket chat with embedded HTML/CSS |
| [`hackernews/app.ts`](https://github.com/cs01/ChadScript/blob/main/examples/hackernews) | Full Hacker News clone — SQLite + embedded assets + JSON API |

```bash
git clone https://github.com/cs01/ChadScript && cd ChadScript

chad run examples/hello.ts
chad run examples/word-count.ts -- README.md
chad run examples/parallel.ts
chad run examples/query.ts
chad run examples/http-server.ts          # http://localhost:3000
chad run examples/websocket/app.ts        # http://localhost:8080
chad run examples/hackernews/app.ts       # http://localhost:3000
```

## Next Steps

- Browse the [Standard Library](/stdlib/) for all available APIs
- See [CLI Reference](/getting-started/cli) for all compiler options
- Check [Supported Features](/language/features) to understand the TypeScript subset
