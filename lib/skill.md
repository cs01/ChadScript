---
name: chadscript
description: Use when writing ChadScript applications, compiling TypeScript to native binaries, or working with the chad CLI. Triggers on ChadScript projects (chadscript.d.ts present), chad CLI usage, or native compilation tasks.
---

# ChadScript

ChadScript compiles TypeScript to native binaries via LLVM IR. It produces fast, single-file executables with no runtime dependency on Node.js.

## CLI

```bash
chad build app.ts           # compile to .build/app
chad build app.ts -o myapp  # compile with custom output
chad run app.ts             # compile and run
chad run app.ts -- arg1     # pass args to the binary
chad watch app.ts           # recompile+run on file changes
chad init                   # scaffold a new project
chad ir app.ts              # emit LLVM IR only
```

## Project Setup

Run `chad init` to generate `chadscript.d.ts` (type definitions), `tsconfig.json`, and `hello.ts`.

The `chadscript.d.ts` file provides type definitions for ChadScript-specific APIs. Keep it in your project root.

## Supported TypeScript Features

ChadScript supports a practical subset of TypeScript:

- Classes with inheritance, interfaces, generics (type-erased)
- Arrays (`number[]`, `string[]`, `object[]`), Maps, Sets
- String/array methods: `map`, `filter`, `find`, `reduce`, `push`, `pop`, `split`, `trim`, `replace`, `indexOf`, `includes`, `slice`, `substring`, `startsWith`, `endsWith`, `padStart`, `padEnd`, etc.
- Template literals, destructuring, spread operator
- `for...of`, `for` loops, `while`, `if/else`, ternary, switch
- `async/await` with `fetch()`, `setTimeout`, `setInterval`
- Closures (capture by value — mutations after capture won't be seen)
- Enums (numeric and string)
- Type assertions (`as`), optional chaining (`?.`), nullish coalescing (`??`)

## Built-in Modules

```typescript
import * as fs from "fs"; // readFileSync, writeFileSync, existsSync, etc.
import * as path from "path"; // join, resolve, dirname, basename, extname
import * as os from "os"; // platform, arch, cpus, totalmem, homedir
import * as child_process from "child_process"; // execSync
```

Also available globally: `console`, `process`, `JSON`, `Math`, `Date`, `setTimeout`, `setInterval`.

## Embedding Files (Single-Binary Deploys)

Embed files at compile time — they're baked into the binary:

```typescript
ChadScript.embedFile("./config.json");
ChadScript.embedDir("./public");

const config = ChadScript.getEmbeddedFile("config.json");
const binary = ChadScript.getEmbeddedFileAsUint8Array("image.png");
```

## HTTP Server

```typescript
function handler(req: HttpRequest): HttpResponse {
  return { status: 200, body: "hello", headers: "" };
}
httpServe(3000, handler);
```

Combine with `ChadScript.embedDir("./public")` and `ChadScript.serveEmbedded(req.path)` for static file serving from a single binary.

## Key Differences from Node.js TypeScript

- **No `node_modules` imports** — only built-in modules and local files
- **No `any` type** — all values must have a concrete type
- **Closures capture by value** — mutating a variable after it's captured in a closure won't update the closure's copy
- Programs exit implicitly — `process.exit()` is only needed to exit early with a specific code
- **Generics use type erasure** — `T` becomes `i8*` (opaque pointer), numeric type params not supported
- **Union types** limited to members with the same LLVM representation

## Cross-Compilation

```bash
chad target add linux-x64
chad build app.ts --target linux-x64
```
