# ChadScript Examples

Working examples demonstrating ChadScript features. Each compiles to a native binary.

## Quick Start

```bash
# Compile an example
chad build examples/hello.ts

# Run the compiled binary
.build/examples/hello
```

## Examples

| File                   | Description                                          |
| ---------------------- | ---------------------------------------------------- |
| `hello.ts`             | Hello World - native execution with no runtime       |
| `parallel.ts`          | Parallel HTTP fetches with async/await + Promise.all |
| `query.ts`             | SQLite database operations                           |
| `timers.ts`            | setTimeout/setInterval with libuv event loop         |
| `word-count.ts`        | File line/word/char counter (like wc)                |
| `cli-parser-demo.ts`   | CLI argument parsing with ArgumentParser             |
| `string-search.ts`     | grep-like search with colorized output               |
| `http-server.ts`       | HTTP server with Express-like routing                |
| `websocket/app.ts`     | WebSocket chat with embedded HTML/CSS                |
| `hackernews/app.ts`    | Full Hacker News clone with SQLite + embedded assets |

## Running

```bash
# Hello world
./.build/examples/hello

# Parallel fetches
./.build/examples/parallel

# SQLite demo
./.build/examples/query

# Timers (runs for ~1.5 seconds)
./.build/examples/timers

# Word count
./.build/examples/word-count README.md
./.build/examples/word-count -l README.md

# CLI parser demo
./.build/examples/cli-parser-demo --verbose --output out.txt myfile.txt

# grep-like search (with color!)
./.build/examples/string-search -rn "function" src/

# HTTP server (http://localhost:3000)
./.build/examples/http-server
./.build/examples/http-server --port 8080

# WebSocket chat (http://localhost:8080)
./.build/examples/websocket/app
./.build/examples/websocket/app --port 9090

# Hacker News clone (http://localhost:3000)
./.build/examples/hackernews/app
./.build/examples/hackernews/app --port 4000
```

## Run All Examples

```bash
npm run examples
```
