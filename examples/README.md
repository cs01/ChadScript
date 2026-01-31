# ChadScript Examples

Working examples demonstrating ChadScript features. Each example can be compiled and run.

## Quick Start

```bash
# Compile an example
npx tsx src/index.ts examples/hello.ts

# Run the compiled binary
./.build/examples/hello
```

## Examples by Category

### Basic (Self-Contained)

These examples run without any external dependencies or network access.

| File | Description |
|------|-------------|
| `hello.ts` | Hello World - basic console output |
| `hello.js` | JavaScript version of Hello World |
| `add.js` | Simple function that adds two numbers |
| `multiply.js` | Multiplication and function chaining |
| `test-simple.ts` | Basic variable and console output test |

### CLI Tools (Self-Contained)

| File | Description |
|------|-------------|
| `cli-parser-demo.ts` | Full CLI parser with flags, options, and positional args |
| `argparse-demo.ts` | ArgumentParser library demo |
| `argparse-cli.ts` | CLI using the argparse library |
| `argparse-cli-fixed.ts` | Fixed version of argparse CLI |
| `argparse-simple.ts` | Simplified argparse example |
| `word-count.ts` | Unix-like wc command implementation |

### HTTP/TCP Networking (Require Local Server)

These examples require a local server to be running or make network requests.

| File | Description | Notes |
|------|-------------|-------|
| `tcp-server.ts` | TCP echo server implementation | Runs a server |
| `simple-http-server.ts` | Basic HTTP server | Runs a server |
| `simple-router.ts` | HTTP router with path matching | Runs a server |
| `request-handler.ts` | HTTP request handling patterns | Runs a server |
| `http-handler.ts` | HTTP handler functions | Runs a server |
| `test-fetch.ts` | HTTP fetch API example | Needs localhost:9999 |
| `github-stars.ts` | Fetch GitHub repo star count | **External network** |

### Language Features (Self-Contained)

| File | Description |
|------|-------------|
| `bool_test.ts` | Boolean field handling in interfaces |
| `class_assign_test.ts` | Class property assignment |
| `obj_assign_test.ts` | Object property assignment |
| `gc_test.ts` | Garbage collection test |

## Running Examples

Most examples print output to stdout. Some require arguments:

```bash
# Word count on a file
./word-count README.md

# CLI with flags
./cli-parser-demo --verbose --output out.txt input.txt
```

## Testing Convention

Examples that are testable print `TEST_PASSED` on success to enable automated validation.
Self-contained examples (marked above) can be run in automated test suites without network access.
