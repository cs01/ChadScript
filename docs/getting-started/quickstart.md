# Examples

## Hello World

```typescript
console.log("Hello from ChadScript!");
```

```bash
chad run hello.ts
```

Or compile to a standalone binary:

```bash
chad build hello.ts -o hello
./hello
```

## HTTP Server

```typescript
function handleRequest(req: HttpRequest): HttpResponse {
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

```typescript
const content = fs.readFileSync("README.md");
const words = content.split(" ");
console.log("Words: ");
console.log(words.length);
```

```bash
$ chad run word-count.ts
Words:
142
```

## Next Steps

- Browse the [Standard Library](/stdlib/) for all available APIs
- See [CLI Reference](/getting-started/cli) for all compiler options
- Check [Type Mappings](/language/type-mappings) to understand how types compile
