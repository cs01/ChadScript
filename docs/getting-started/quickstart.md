# Quick Start

## Run Your First Program

```bash
chad run examples/hello.ts
```

This compiles and runs in one step — perfect for getting started.

## Compile and Run Separately

```bash
chad build examples/hello.ts
.build/examples/hello
```

## Hello World

Create a file `hello.ts`:

```typescript
console.log("Hello from ChadScript!");
```

Compile and run it:

```bash
chad build hello.ts -o hello
./hello
```

## HTTP Server

ChadScript can build a native HTTP server in a single file:

```typescript
function handleRequest(req: Request): Response {
  if (req.path == "/") {
    return { status: 200, body: "<h1>Hello from ChadScript</h1>" };
  }
  return { status: 404, body: "Not Found" };
}

httpServe(3000, handleRequest);
```

```bash
chad build server.ts -o server
./server &
curl http://localhost:3000
```

## CLI Tool

Read files, parse arguments, process text:

```typescript
const filename = process.argv[0];
const content = fs.readFileSync(filename);
const words = content.split(" ");
console.log("Words: ");
console.log(words.length);
```

```bash
$ chad run word-count.ts -- README.md
Words:
142
```

## Next Steps

- Browse the [Standard Library](/stdlib/) for all available APIs
- See [CLI Reference](/getting-started/cli) for all compiler options
- Check [Type Mappings](/language/type-mappings) to understand how types compile
