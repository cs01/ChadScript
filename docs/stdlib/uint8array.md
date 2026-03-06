# Uint8Array

A fixed-length array of 8-bit unsigned integers. Used for binary data — file contents, HTTP request/response bodies, embedded assets, and any other byte-oriented data.

```typescript
const buf: Uint8Array = fs.readFileSync("image.png");
console.log(buf.length); // byte count
```

## Creating

### `new Uint8Array(length)`

Allocate a zero-filled buffer of `length` bytes.

```typescript
const buf = new Uint8Array(1024);
```

### `Buffer.from(str, 'base64')`

Decode a base64 string into a `Uint8Array`.

```typescript
const decoded: Uint8Array = Buffer.from("aGVsbG8=", "base64");
```

### `Uint8Array.fromRawBytes(ptr, len)`

Wrap a raw byte pointer and length. Used internally by `bodyBytes()` and similar APIs — rarely needed in user code.

## Properties

### `.length`

Number of bytes in the array.

```typescript
const buf: Uint8Array = fs.readFileSync("file.bin");
console.log(buf.length);
```

## Where Uint8Array appears

| API | Notes |
|-----|-------|
| `fs.readFileSync(path)` | Returns `Uint8Array` |
| `fs.writeFileSync(path, data)` | Accepts `Uint8Array` |
| `req.bodyBytes()` | Binary-safe request body as `Uint8Array` |
| `c.bytes(data, contentType)` | Router response from `Uint8Array` |
| `bytesResponse(data, status, headers)` | Raw HTTP response from `Uint8Array` |
| `ChadScript.getEmbeddedFileAsUint8Array(key)` | Embedded file as `Uint8Array` |
| `Buffer.from(str, 'base64')` | Base64 decode → `Uint8Array` |

## Example: binary HTTP response

```typescript
import { httpServe, bytesResponse } from "chadscript/http";

function handleRequest(req: HttpRequest): HttpResponse {
  if (req.path == "/image") {
    const data: Uint8Array = fs.readFileSync("./assets/photo.jpg");
    return bytesResponse(data, 200, "Content-Type: image/jpeg");
  }
  return { status: 404, body: "Not Found", headers: "", bodyLen: 0 };
}

httpServe(3000, handleRequest);
```

## Example: binary upload

```typescript
function handleRequest(req: HttpRequest): HttpResponse {
  if (req.method == "POST" && req.path == "/upload") {
    const data: Uint8Array = req.bodyBytes();
    console.log("received " + data.length.toString() + " bytes");
    fs.writeFileSync("/tmp/upload.bin", data);
    return { status: 200, body: "OK", headers: "", bodyLen: 0 };
  }
  return { status: 404, body: "Not Found", headers: "", bodyLen: 0 };
}
```
