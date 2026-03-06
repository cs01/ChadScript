# Encoding

Global functions for base64 and percent-encoding (URL encoding). Available without any import.

## `btoa(str)`

Encode a string to base64.

```typescript
const encoded = btoa("hello world");
// "aGVsbG8gd29ybGQ="

const auth = "Basic " + btoa(username + ":" + password);
```

## `atob(str)`

Decode a base64 string.

```typescript
const decoded = atob("aGVsbG8gd29ybGQ=");
// "hello world"
```

## `encodeURIComponent(str)`

Percent-encode a string per RFC 3986. Unreserved characters (`A-Z a-z 0-9 - _ . ~`) are left as-is; everything else is encoded as `%XX`.

```typescript
const q = encodeURIComponent("hello world & foo=bar");
// "hello%20world%20%26%20foo%3Dbar"

const url = "https://api.example.com/search?q=" + encodeURIComponent(userInput);
```

## `decodeURIComponent(str)`

Decode a percent-encoded string.

```typescript
const s = decodeURIComponent("hello%20world%20%26%20foo%3Dbar");
// "hello world & foo=bar"
```

## Example

```typescript
const token = btoa("user:pass");
console.log(token); // "dXNlcjpwYXNz"
console.log(atob(token)); // "user:pass"

const params = "name=" + encodeURIComponent("John Doe") + "&city=" + encodeURIComponent("New York");
// "name=John%20Doe&city=New%20York"
```

## Native Implementation

| API | Maps to |
|-----|---------|
| `btoa()` | `cs_btoa()` in `c_bridges/base64-bridge.c` |
| `atob()` | `cs_atob()` in `c_bridges/base64-bridge.c` |
| `encodeURIComponent()` | `cs_encode_uri_component()` in `c_bridges/uri-bridge.c` |
| `decodeURIComponent()` | `cs_decode_uri_component()` in `c_bridges/uri-bridge.c` |
