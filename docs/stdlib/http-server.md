# httpServe

Built-in HTTP server with websocket support compiled to native code via libuv TCP + picohttpparser.

## `httpServe(port, handler)`

Start an HTTP server on the given port. The handler function receives an `HttpRequest` and returns an `HttpResponse`.

```typescript
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
interface WsEvent {
  data: string;
  event: string;  // "open", "message", "close"
  connId: string; // hex pointer identifying this connection
}

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
wsBroadcast("hello everyone");
```

## `wsSend(connId, message)`

Send a message to a specific WebSocket connection identified by its `connId`. The `connId` is available on every `WsEvent`.

```typescript
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
| `body` | `string` | Request body |
| `contentType` | `string` | Content-Type header value |
| `headers` | `string` | All request headers as `"Key: Value\n..."` string |

## HttpResponse Object

| Property | Type | Description |
|----------|------|-------------|
| `status` | `number` | HTTP status code |
| `body` | `string` | Response body |
| `headers` | `string` | Extra response headers as `"\n"`-separated lines (e.g. `"Set-Cookie: session=abc\nX-Custom: value"`) |

If `headers` contains a `Content-Type:` line, it overrides the auto-detected content type. Set `headers` to `""` when no extra headers are needed.

## WsEvent Object

| Property | Type | Description |
|----------|------|-------------|
| `data` | `string` | Message data (empty for open/close events) |
| `event` | `string` | Event type: `"open"`, `"message"`, or `"close"` |
| `connId` | `string` | Hex pointer identifying this connection (use with `wsSend`) |

## Example

A full HTTP server with routing:

```typescript
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
interface WsEvent {
  data: string;
  event: string;
  connId: string;
}

interface HttpRequest {
  method: string;
  path: string;
  body: string;
  contentType: string;
  headers: string;
}

interface HttpResponse {
  status: number;
  body: string;
  headers: string;
}

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

Parse `multipart/form-data` request bodies (file uploads, form submissions) using `ChadScript.parseMultipart()`:

```typescript
interface MultipartPart {
  name: string;        // field name
  filename: string;    // original filename (empty string if not a file upload)
  contentType: string; // part Content-Type
  data: string;        // part body
  dataLen: number;     // byte length of data
}

function handleRequest(req: HttpRequest): HttpResponse {
  if (req.method == "POST" && req.path == "/upload") {
    const parts: MultipartPart[] = ChadScript.parseMultipart(req);

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
