# HTTP Server

Built-in HTTP server with websocket support compiled to native code via libuv TCP + picohttpparser.

All HTTP server APIs are imported from `chadscript/http`:

```typescript
import { httpServe, wsBroadcast, wsSend, parseMultipart,
         getHeader, parseQueryString, parseCookies } from "chadscript/http";
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
  // Read request
  const id    = c.req.param("id");           // URL param
  const auth  = c.req.header("Authorization"); // request header
  const body  = c.req.body;                   // raw body (string)
  const bytes = c.req.bodyBytes();            // raw body as Uint8Array (binary-safe)
  const method = c.req.method;               // "GET", "POST", …

  // Build response (chainable)
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

### HTTP utility functions

`chadscript/http` includes helpers for parsing common request data:

```typescript
import { getHeader, parseQueryString, parseCookies } from "chadscript/http";

// Parse a single request header by name (case-insensitive)
const auth = getHeader(req.headers, "Authorization"); // "Bearer abc"

// Parse a query string into a Map
const qs = parseQueryString("page=2&limit=10");
qs.get("page");    // "2"
qs.get("limit");   // "10"

// Parse the Cookie header into a Map
const cookies = parseCookies(getHeader(req.headers, "Cookie"));
cookies.get("session"); // "abc123"
```

---

## `httpServe(port, handler)`

Start an HTTP server on the given port. The handler function receives an `HttpRequest` and returns an `HttpResponse`.

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

## `httpServe(port, handler, wsHandler)`

Start an HTTP server with WebSocket support. The third argument is a WebSocket handler that receives a `WsEvent` and returns a string.

Any HTTP request with an `Upgrade: websocket` header is automatically upgraded when a wsHandler is registered.

```typescript
import { httpServe, wsBroadcast } from "chadscript/http";

function wsHandler(event: WsEvent): string {
  if (event.event == "message") {
    wsBroadcast("someone said: " + event.data);
    return "echo: " + event.data;  // sent back to sender
  }
  return "";  // empty = no response
}

httpServe(3000, handleRequest, wsHandler);
```

## `wsBroadcast(message)`

Send a message to all connected WebSocket clients. Only available when a wsHandler is registered.

```typescript
import { wsBroadcast } from "chadscript/http";

wsBroadcast("hello everyone");
```

## `wsSend(connId, message)`

Send a message to a specific WebSocket connection identified by its `connId`. The `connId` is available on every `WsEvent`.

```typescript
import { wsSend } from "chadscript/http";

function wsHandler(event: WsEvent): string {
  if (event.event == "message") {
    wsSend(event.connId, "echo: " + event.data);  // reply to sender only
    return "";
  }
  return "";
}
```

## HttpRequest Object

| Property | Type | Description |
|----------|------|-------------|
| `method` | `string` | HTTP method (`"GET"`, `"POST"`, etc.) |
| `path` | `string` | Request path (`"/"`, `"/api/users"`, etc.) |
| `body` | `string` | Request body (use `bodyLen` for binary-safe length) |
| `bodyLen` | `number` | Exact byte length of `body` — use this instead of `body.length` for binary data |
| `contentType` | `string` | Content-Type header value |
| `headers` | `string` | All request headers as `"Key: Value\n..."` string |

## HttpResponse Object

| Property | Type | Description |
|----------|------|-------------|
| `status` | `number` | HTTP status code |
| `body` | `string` | Response body |
| `bodyLen` | `number` | Byte length of body for binary responses — set to `0` for text responses (server uses `strlen`), set to the actual byte count for binary data |
| `headers` | `string` | Extra response headers as `"\n"`-separated lines (e.g. `"Set-Cookie: session=abc\nX-Custom: value"`) |

If `headers` contains a `Content-Type:` line, it overrides the auto-detected content type. Set `headers` to `""` when no extra headers are needed.

For binary responses built by hand, set `bodyLen` to the actual byte count. Text responses can leave it as `0`.

## WsEvent Object

| Property | Type | Description |
|----------|------|-------------|
| `data` | `string` | Message data (empty for open/close events) |
| `event` | `string` | Event type: `"open"`, `"message"`, or `"close"` |
| `connId` | `string` | Hex pointer identifying this connection (use with `wsSend`) |

## Example

A full HTTP server with routing:

```typescript
import { httpServe } from "chadscript/http";

function homeHandler(req: HttpRequest): HttpResponse {
  return { status: 200, body: "<h1>Hello from ChadScript</h1>", headers: "" };
}

function jsonHandler(req: HttpRequest): HttpResponse {
  return { status: 200, body: '{"message":"hello","count":42}', headers: "Content-Type: application/json" };
}

function handleRequest(req: HttpRequest): HttpResponse {
  if (req.method == "GET") {
    if (req.path == "/") return homeHandler(req);
    if (req.path == "/json") return jsonHandler(req);
  }
  return { status: 404, body: "Not Found", headers: "" };
}

httpServe(3000, handleRequest);
```

```bash
$ chad build server.ts -o server
$ ./server &
$ curl http://localhost:3000/json
{"message":"hello","count":42}
```

## WebSocket Example

A chat server with HTTP homepage and WebSocket messaging:

```typescript
import { httpServe, wsBroadcast } from "chadscript/http";

function wsHandler(event: WsEvent): string {
  if (event.event == "message") {
    wsBroadcast("someone said: " + event.data);
    return "echo: " + event.data;
  }
  return "";
}

function handleRequest(req: HttpRequest): HttpResponse {
  return { status: 200, body: "<h1>WebSocket Chat</h1>", headers: "" };
}

httpServe(8080, handleRequest, wsHandler);
```

```bash
$ chad build chat.ts -o chat
$ ./chat &
$ websocat ws://localhost:8080/
> hello
< echo: hello
```

## Response Headers Example

Set cookies, CORS headers, or override Content-Type:

```typescript
function handleRequest(req: HttpRequest): HttpResponse {
  if (req.path == "/api/data") {
    return {
      status: 200,
      body: '{"ok":true}',
      headers: "Content-Type: application/json\nSet-Cookie: session=abc; Path=/",
    };
  }
  return { status: 404, body: "Not Found", headers: "" };
}
```

Multiple headers are separated by `\n`. The server normalizes them to `\r\n` in the HTTP response.

## Multipart Form Data

Parse `multipart/form-data` request bodies (file uploads, form submissions) using `parseMultipart()`:

```typescript
import { httpServe, parseMultipart } from "chadscript/http";

interface MultipartPart {
  name: string;        // field name
  filename: string;    // original filename (empty string if not a file upload)
  contentType: string; // part Content-Type
  data: string;        // part body
  dataLen: number;     // byte length of data
}

function handleRequest(req: HttpRequest): HttpResponse {
  if (req.method == "POST" && req.path == "/upload") {
    const parts: MultipartPart[] = parseMultipart(req);

    for (let i = 0; i < parts.length; i++) {
      console.log("field: " + parts[i].name);
      if (parts[i].filename != "") {
        console.log("  file: " + parts[i].filename);
        console.log("  size: " + parts[i].dataLen.toString());
      }
    }

    return { status: 200, body: "Uploaded", headers: "" };
  }
  return { status: 404, body: "Not Found", headers: "" };
}
```

The parser handles RFC 2046 multipart boundaries, Content-Disposition headers, and per-part Content-Type headers. It uses a C bridge (`multipart-bridge.c`) for the boundary scanning.

## Request Headers Example

Access incoming request headers (e.g. for authentication):

```typescript
function handleRequest(req: HttpRequest): HttpResponse {
  // req.headers contains all headers as "Key: Value\n..." string
  if (req.headers.indexOf("Authorization:") >= 0) {
    return { status: 200, body: "Authenticated", headers: "" };
  }
  return { status: 401, body: "Unauthorized", headers: "" };
}
```

## `serveFile(path, contentType)`

Serve a file from disk as a binary-safe `HttpResponse`. Reads the file with `fs.readFileSync` and returns a 200 response with the correct `Content-Type` and `bodyLen` set.

```typescript
import { httpServe, serveFile } from "chadscript/http";

function handleRequest(req: HttpRequest): HttpResponse {
  if (req.path == "/logo.png") {
    return serveFile("./assets/logo.png", "image/png");
  }
  return { status: 404, body: "Not Found", headers: "", bodyLen: 0 };
}

httpServe(3000, handleRequest);
```

For serving compile-time embedded files, see [`ChadScript.serveEmbedded`](/stdlib/embed#chadscriptserveembeddedpath).

## `bytesResponse(data, status, headers)`

Build an `HttpResponse` from a `Uint8Array`. Use this when you have binary data in memory and need to return it as an HTTP response.

```typescript
import { httpServe, bytesResponse } from "chadscript/http";

function handleRequest(req: HttpRequest): HttpResponse {
  if (req.path == "/data") {
    const data: Uint8Array = buildBinaryPayload();
    return bytesResponse(data, 200, "Content-Type: application/octet-stream");
  }
  return { status: 404, body: "Not Found", headers: "", bodyLen: 0 };
}
```

`headers` follows the same `"\n"`-separated format as `HttpResponse.headers`. Pass `""` when no extra headers are needed.

## Native Implementation

| API | Maps to |
|-----|---------|
| `httpServe()` | libuv TCP + picohttpparser (zero-copy HTTP parsing) |
| `wsBroadcast()` | `lws_bridge_ws_broadcast()` to all tracked connections |
| `wsSend()` | `lws_bridge_ws_send_to()` — parses hex connId, sends to matching handle |
| WebSocket upgrade | embedded SHA-1 + base64 handshake + frame parser |

## Transparent Compression

Responses are automatically compressed when:

1. The client sends an `Accept-Encoding` header
2. The response body is larger than 256 bytes
3. The compressed output is smaller than the original

The server prefers **zstd** over **deflate**. If the client supports both, zstd is used. If only deflate is supported, deflate is used. No changes to user code are needed — compression is fully transparent.

| Priority | Encoding | Header | Library |
|----------|----------|--------|---------|
| 1 | zstd | `Content-Encoding: zstd` | libzstd |
| 2 | deflate | `Content-Encoding: deflate` | zlib |
