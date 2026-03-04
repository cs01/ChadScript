# Standard Library

Everything is built in. No `npm install`, no `node_modules`, no bundler. All APIs compile to native code — no runtime overhead.

API names match Node.js where applicable (`fs.readFileSync`, `process.argv`, `path.join`, `console.log`, etc.), so the code you write looks like standard TypeScript.

Browse the sidebar for the full API reference.

## Globals vs. Modules

Most APIs are available as globals with no import required:

```typescript
console.log("hello");
const data = fs.readFileSync("file.txt");
const hash = crypto.createHash("sha256");
```

Some APIs live in named stdlib modules and must be imported:

| Module | Contents |
|--------|----------|
| `chadscript/http` | `httpServe`, `wsBroadcast`, `wsSend`, `parseMultipart`, `getHeader`, `parseQueryString`, `parseCookies` |
| `chadscript/router` | `Router`, `Context`, `RouterRequest` |
| `chadscript/argparse` | `ArgumentParser` |

```typescript
import { httpServe, getHeader } from "chadscript/http";
import { Router, Context } from "chadscript/router";
import { ArgumentParser } from "chadscript/argparse";
```

The `chadscript/` prefix works like Node's `node:` prefix — unambiguous and collision-free.

## Editor Support

Run `chad init` in your project directory to generate type definitions for your editor:

```bash
chad init
```

This creates:
- **`chadscript.d.ts`** — type declarations for all built-in APIs so your editor provides autocomplete and type checking
- **`tsconfig.json`** — configured for ChadScript's supported TypeScript subset
- **`hello.ts`** — a starter file

Your editor (VS Code, etc.) will immediately recognize all ChadScript globals without any red squiggles.
