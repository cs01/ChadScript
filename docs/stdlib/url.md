# URL

Built-in `URL` and `URLSearchParams` classes for parsing and manipulating URLs. Available without any import.

## `URL`

Parse a URL string into its components.

```typescript
const u = new URL("https://example.com:8080/path/to/page?q=hello&page=2#section");

u.protocol  // "https:"
u.hostname  // "example.com"
u.port      // "8080"
u.host      // "example.com:8080"
u.pathname  // "/path/to/page"
u.search    // "?q=hello&page=2"
u.hash      // "#section"
u.origin    // "https://example.com:8080"
u.href      // "https://example.com:8080/path/to/page?q=hello&page=2#section"
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `protocol` | `string` | Scheme with colon — `"https:"` |
| `hostname` | `string` | Host without port — `"example.com"` |
| `port` | `string` | Port number as string, or `""` if absent |
| `host` | `string` | `hostname` + `:` + `port` if port present |
| `pathname` | `string` | Path component — `"/path/to/page"` |
| `search` | `string` | Query string including `?`, or `""` |
| `hash` | `string` | Fragment including `#`, or `""` |
| `origin` | `string` | `protocol + "//" + host` |
| `href` | `string` | Full URL string |

## `URLSearchParams`

Parse and manipulate query strings.

```typescript
const p = new URLSearchParams("q=hello&page=2");

p.get("q")     // "hello"
p.get("page")  // "2"
p.has("q")     // true
p.has("foo")   // false

p.set("q", "world")
p.append("tag", "foo")
p.delete("page")

p.toString()   // "q=world&tag=foo"
```

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `get(key)` | `string` | Value for key, or `""` if absent |
| `has(key)` | `boolean` | Whether key exists |
| `set(key, value)` | `void` | Set or replace value for key |
| `append(key, value)` | `void` | Add key/value (allows duplicates) |
| `delete(key)` | `void` | Remove all entries for key |
| `toString()` | `string` | Serialize back to query string (no leading `?`) |

## Native Implementation

| API | Maps to |
|-----|---------|
| `URL` properties | `cs_url_parse_*()` in `c_bridges/url-bridge.c` |
| `URLSearchParams` methods | `cs_urlsearch_*()` in `c_bridges/url-bridge.c` |
