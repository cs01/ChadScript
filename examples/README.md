# ChadScript Examples

Working examples demonstrating ChadScript features. Each compiles to a native binary.

## Quick Start

```bash
# Compile and run in one step
chad run examples/hello.ts

# Or compile separately if you prefer
chad build examples/hello.ts
.build/examples/hello
```

## Examples

| File                 | Description                                          |
| -------------------- | ---------------------------------------------------- |
| `hello.ts`           | Hello World - native execution with no runtime       |
| `parallel.ts`        | Parallel HTTP fetches with async/await + Promise.all |
| `query.ts`           | SQLite database operations                           |
| `timers.ts`          | setTimeout/setInterval with libuv event loop         |
| `word-count.ts`      | File line/word/char counter (like wc)                |
| `cli-parser-demo.ts` | CLI argument parsing with ArgumentParser             |
| `string-search.ts`   | grep-like search with colorized output               |
| `http-server.ts`     | HTTP server with Express-like routing                |
| `websocket/app.ts`   | WebSocket chat with embedded HTML/CSS                |
| `hackernews/app.ts`  | Full Hacker News clone with SQLite + embedded assets |

## Running

```bash
# Hello world
chad run examples/hello.ts

# Parallel fetches
chad run examples/parallel.ts

# SQLite demo
chad run examples/query.ts

# Timers
chad run examples/timers.ts

# Word count
chad run examples/word-count.ts -- README.md
chad run examples/word-count.ts -- -l README.md

# CLI parser demo
chad run examples/cli-parser-demo.ts -- --verbose --output out.txt myfile.txt

# grep-like search (with color!)
chad run examples/string-search.ts -- -r -n "function" src/

# HTTP server (http://localhost:3000)
chad run examples/http-server.ts
chad run examples/http-server.ts -- --port 8080

# WebSocket chat (http://localhost:8080)
chad run examples/websocket/app.ts
chad run examples/websocket/app.ts -- --port 9090

# Hacker News clone (http://localhost:3000)
chad run examples/hackernews/app.ts
chad run examples/hackernews/app.ts -- --port 4000
```

## Run All Examples

```bash
npm run examples
```
