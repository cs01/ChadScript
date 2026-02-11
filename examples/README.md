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

| File | Description |
|------|-------------|
| `hello.ts` | Hello World - native execution with no runtime |
| `timers.ts` | setTimeout/setInterval async timers |
| `http-server.ts` | HTTP server with Request/Response routing |
| `cli-parser-demo.ts` | CLI argument parsing with flags and options |
| `word-count.ts` | File processing - lines, words, characters |

## Running

```bash
# Hello world
./.build/examples/hello

# Timers (runs for ~1.5 seconds)
./.build/examples/timers

# HTTP server (runs on port 3000)
./.build/examples/http-server

# CLI with arguments
./.build/examples/cli-parser-demo --verbose --output out.txt input.txt

# Word count
./.build/examples/word-count README.md
```

## Run All Examples

```bash
npm run examples
```
