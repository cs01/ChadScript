# HTTP Server

Built-in HTTP server with WebSocket support compiled to native code via libuv TCP + picohttpparser.

All HTTP server APIs are imported from `chadscript/http`:

```typescript
import { httpServe, Router, Context, wsBroadcast, wsSend,
         getHeader, parseQueryString, parseCookies,
         serveFile, bytesResponse, parseMultipart } from "chadscript/http";
```

## Router (recommended)

For most servers, use the `Router` class. It provides an Express/Hono-style API with URL parameter extraction, method matching, and chainable response helpers.

```typescript
import { httpServe, Router, Context } from "chadscript/http";

const app: Router = new Router();

app.get("/", (c: Context) => c.json({ status: "ok" }));

app.get("/api/users/:id", (c: Context) => {
  const id = c.req.param("id");
  return c.json({ id });
});

app.post("/api/users", (c: Context) => {
  c.status(201);
  return c.text("Created");
});

app.notFound((c: Context) => {
  c.status(404);
  return c.text("Not Found");
});

httpServe(3000, (req) => app.handle(req));
```

### Router methods

| Method | Description |
|--------|-------------|
| `app.get(pattern, handler)` | Register GET route |
| `app.post(pattern, handler)` | Register POST route |
| `app.put(pattern, handler)` | Register PUT route |
| `app.delete(pattern, handler)` | Register DELETE route |
| `app.all(pattern, handler)` | Match any HTTP method |
| `app.notFound(handler)` | Custom 404 handler |
| `app.handle(req)` | Dispatch an `HttpRequest` → `HttpResponse` |

Route patterns support `:param` segments and `*` wildcards:

```typescript
app.get("/users/:id", ...);              // /users/42 → param("id") == "42"
app.get("/users/:name/posts/:pid", ...); // multiple params
app.all("/static/*", ...);              // wildcard
```

### Context API

The handler receives a `Context` (aliased as `c` by convention):

```typescript
app.get("/example", (c: Context) => {
  const id     = c.req.param("id");              // URL param
  const auth   = c.req.header("Authorization");  // request header
  const body   = c.req.body;                     // raw body (string)
  const bytes  = c.req.bodyBytes();              // raw body as Uint8Array (binary-safe)
  const method = c.req.method;                   // "GET", "POST", …
  const qs     = c.req.queryString;              // raw query string ("page=2&limit=10")

  c.status(201);
  c.header("X-Custom", "value");
  return c.json({ ok: true });
});
```

**Response methods** — call one to return the `HttpResponse`:

| Method | Content-Type | Notes |
|--------|--------------|-------|
| `c.text(body)` | `text/plain` | |
| `c.json(body)` | `application/json` | objects/arrays are auto-serialized; strings pass through as-is |
| `c.html(body)` | `text/html` | |
| `c.redirect(url)` | — | 302, sets `Location` header |
| `c.bytes(data, contentType)` | `contentType` | binary-safe; use for images, files, etc. |

**Chainable setters** (return `Context`, call before a response method):

| Method | Effect |
|--------|--------|
| `c.status(code)` | Set HTTP status code |
| `c.header(name, value)` | Add a response header |

## HTTP utility functions

`chadscript/http` includes helpers for parsing common request data:

```typescript
import { getHeader, parseQueryString, parseCookies } from "chadscript/http";

const auth = getHeader(req.headers, "Authorization"); // "Bearer abc"

const qs = parseQueryString("page=2&limit=10");
qs.get("page");   // "2"
qs.get("limit");  // "10"

const cookies = parseCookies(getHeader(req.headers, "Cookie"));
cookies.get("session"); // "abc123"
```

## Serving files

### `serveFile(path, contentType)`

Serve a file from disk as a binary-safe `HttpResponse`. Reads the file and returns a 200 response with the correct `Content-Type` and `bodyLen` set.

```typescript
import { httpServe, serveFile } from "chadscript/http";

const app: Router = new Router();

app.get("/logo.png", (c: Context) => serveFile("./assets/logo.png", "image/png"));

httpServe(3000, (req) => app.handle(req));
```

### `bytesResponse(data, status, headers)`

Build an `HttpResponse` from a `Uint8Array`. Use this when you have binary data in memory and need to return it as an HTTP response.

```typescript
import { bytesResponse } from "chadscript/http";

app.get("/data", (c: Context) => {
  const data: Uint8Array = buildBinaryPayload();
  return bytesResponse(data, 200, "Content-Type: application/octet-stream");
});
```

`headers` follows the same `"\n"`-separated format as `HttpResponse.headers`. Pass `""` when no extra headers are needed.

### `ChadScript.serveEmbedded(path)`

Serve a file that was embedded into the binary at compile time. Strips the leading `/` from the path, looks up the file in the embedded table, and returns a 200 response if found or a 404 if not. Content-Type is inferred automatically from the file extension.

```typescript
import { httpServe, Router, Context } from "chadscript/http";

ChadScript.embedDir("./public");

const app: Router = new Router();

app.get("/api/status", (c: Context) => c.json({ ok: true }));
app.all("/*", (c: Context) => ChadScript.serveEmbedded(c.req.path));

httpServe(3000, (req) => app.handle(req));
```

See [embed](./embed.md) for how to embed files at compile time.

---

## Low-level API

The sections below document the raw `httpServe` interface with manual `HttpRequest`/`HttpResponse` structs. Use this when you need full control over dispatch logic or when integrating WebSockets alongside custom HTTP handling.

### `httpServe(port, handler)`

Start an HTTP server on the given port. The handler receives an `HttpRequest` and returns an `HttpResponse`.

```typescript
import { httpServe } from "chadscript/http";

function handleRequest(req: HttpRequest): HttpResponse {
  if (req.path == "/") {
    return { status: 200, body: "Hello!", headers: "" };
  }
  return { status: 404, body: "Not Found", headers: "" };
}

httpServe(3000, handleRequest);
```

### `httpServe(port, handler, wsHandler)`

Start an HTTP server with WebSocket support. Any HTTP request with an `Upgrade: websocket` header is automatically upgraded when a `wsHandler` is registered.

```typescript
import { httpServe, wsBroadcast } from "chadscript/http";

function wsHandler(event: WsEvent): string {
  if (event.event == "message") {
    wsBroadcast("someone said: " + event.data);
    return "echo: " + event.data;
  }
  return "";
}

httpServe(3000, handleRequest, wsHandler);
```

### `wsBroadcast(message)`

Send a message to all connected WebSocket clients.

```typescript
import { wsBroadcast } from "chadscript/http";

wsBroadcast("hello everyone");
```

### `wsSend(connId, message)`

Send a message to a specific WebSocket connection by its `connId`. The `connId` is available on every `WsEvent`.

```typescript
import { wsSend } from "chadscript/http";

function wsHandler(event: WsEvent): string {
  if (event.event == "message") {
    wsSend(event.connId, "echo: " + event.data);
    return "";
  }
  return "";
}
```

### Multipart form data

Parse `multipart/form-data` request bodies (file uploads, form submissions):

```typescript
import { httpServe, parseMultipart } from "chadscript/http";

interface MultipartPart {
  name: string;
  filename: string;
  contentType: string;
  data: string;
  dataLen: number;
}

function handleRequest(req: HttpRequest): HttpResponse {
  if (req.method == "POST" && req.path == "/upload") {
    const parts: MultipartPart[] = parseMultipart(req);
    for (const part of parts) {
      console.log("field: " + part.name);
      if (part.filename != "") {
        console.log("  file: " + part.filename + " (" + part.dataLen.toString() + " bytes)");
      }
    }
    return { status: 200, body: "Uploaded", headers: "" };
  }
  return { status: 404, body: "Not Found", headers: "" };
}
```

---

## Request / Response reference

### HttpRequest

| Property | Type | Description |
|----------|------|-------------|
| `method` | `string` | HTTP method (`"GET"`, `"POST"`, etc.) |
| `path` | `string` | Request path (`"/"`, `"/api/users"`, etc.) |
| `body` | `string` | Request body |
| `bodyLen` | `number` | Exact byte length of `body` — use for binary data instead of `body.length` |
| `contentType` | `string` | Content-Type header value |
| `headers` | `string` | All request headers as `"Key: Value\n..."` string |
| `queryString` | `string` | Raw query string (e.g. `"page=2&limit=10"`), without the leading `?` |

### HttpResponse

| Property | Type | Description |
|----------|------|-------------|
| `status` | `number` | HTTP status code |
| `body` | `string` | Response body |
| `bodyLen` | `number` | Byte length of body for binary responses — set to `0` for text (server uses `strlen`), set to the actual byte count for binary data |
| `headers` | `string` | Extra response headers as `"\n"`-separated lines (e.g. `"Set-Cookie: session=abc\nX-Custom: value"`) |

If `headers` contains a `Content-Type:` line, it overrides the auto-detected content type. Set `headers` to `""` when no extra headers are needed.

### WsEvent

| Property | Type | Description |
|----------|------|-------------|
| `data` | `string` | Message data (empty for open/close events) |
| `event` | `string` | Event type: `"open"`, `"message"`, or `"close"` |
| `connId` | `string` | Hex pointer identifying this connection (use with `wsSend`) |

---

## Native implementation

| API | Maps to |
|-----|---------|
| `httpServe()` | libuv TCP + picohttpparser (zero-copy HTTP parsing) |
| `wsBroadcast()` | `lws_bridge_ws_broadcast()` to all tracked connections |
| `wsSend()` | `lws_bridge_ws_send_to()` — parses hex connId, sends to matching handle |
| WebSocket upgrade | embedded SHA-1 + base64 handshake + frame parser |

## Transparent compression

Responses are automatically compressed when:

1. The client sends an `Accept-Encoding` header
2. The response body is larger than 256 bytes
3. The compressed output is smaller than the original

The server prefers **zstd** over **deflate**. No changes to user code are needed — compression is fully transparent.

| Priority | Encoding | Header | Library |
|----------|----------|--------|---------|
| 1 | zstd | `Content-Encoding: zstd` | libzstd |
| 2 | deflate | `Content-Encoding: deflate` | zlib |
