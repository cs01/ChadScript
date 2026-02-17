# Quick Start

See [Installation](/getting-started/installation) for setup and your first program.

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
