# httpServe

Built-in HTTP server compiled to native code via the mongoose networking library.

## `httpServe(port, handler)`

Start an HTTP server on the given port. The handler function receives a `Request` and returns a `Response`.

```typescript
function handleRequest(req: Request): Response {
  if (req.path == "/") {
    return { status: 200, body: "Hello!" };
  }
  return { status: 404, body: "Not Found" };
}

httpServe(3000, handleRequest);
```

## Request Object

| Property | Type | Description |
|----------|------|-------------|
| `method` | `string` | HTTP method (`"GET"`, `"POST"`, etc.) |
| `path` | `string` | Request path (`"/"`, `"/api/users"`, etc.) |
| `body` | `string` | Request body |

## Response Object

| Property | Type | Description |
|----------|------|-------------|
| `status` | `number` | HTTP status code |
| `body` | `string` | Response body |

## Example

A full HTTP server with routing:

```typescript
function homeHandler(req: Request): Response {
  return { status: 200, body: "<h1>Hello from ChadScript</h1>" };
}

function jsonHandler(req: Request): Response {
  return { status: 200, body: '{"message":"hello","count":42}' };
}

function handleRequest(req: Request): Response {
  if (req.method == "GET") {
    if (req.path == "/") return homeHandler(req);
    if (req.path == "/json") return jsonHandler(req);
  }
  return { status: 404, body: "Not Found" };
}

httpServe(3000, handleRequest);
```

```bash
$ chad build server.ts -o server
$ ./server &
$ curl http://localhost:3000/json
{"message":"hello","count":42}
```

## Native Implementation

| API | Maps to |
|-----|---------|
| `httpServe()` | mongoose HTTP server library |
