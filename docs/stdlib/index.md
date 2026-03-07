# Standard Library

ChadScript ships with a standard library that covers the most common needs — file I/O, networking, databases, crypto, JSON, and more. Everything is built in and compiles directly to native code. There are no packages to install and no bundler required.

API names follow Node.js conventions where it makes sense (`fs.readFileSync`, `process.argv`, `path.join`, `console.log`), so the code reads like familiar TypeScript.

## Globals

Most APIs are available everywhere with no import:

```typescript
console.log("hello");
const data = fs.readFileSync("file.txt");
const hash = crypto.sha256("hello");
const encoded = btoa("hello");
const url = "https://api.example.com/q=" + encodeURIComponent(query);
const u = new URL("https://example.com:8080/path?q=hello");
const p = new URLSearchParams("q=hello&page=2");
```

## Modules

A few APIs live in named modules and need an import:

```typescript
import { httpServe, Router, Context } from "chadscript/http";
import { ArgumentParser } from "chadscript/argparse";
```

| Module | Contents |
|--------|----------|
| `chadscript/http` | `httpServe`, `wsBroadcast`, `wsSend`, `parseMultipart`, `bytesResponse`, `serveFile`, `getHeader`, `parseQueryString`, `parseCookies`, `Router`, `Context`, `RouterRequest` |
| `chadscript/argparse` | `ArgumentParser` |

The `chadscript/` prefix works like Node's `node:` prefix — unambiguous and collision-free.
