# ChadScript.embed

Compile-time file embedding. Reads files from disk during compilation and bakes their contents directly into the native binary as string constants. At runtime, accessing embedded files is instant — no file I/O, no filesystem dependency.

This is useful for bundling HTML, CSS, templates, config files, or any static assets into a single self-contained binary.

## `ChadScript.embedFile(path)`

Embed a single file at compile time. Returns the file contents as a string.

```typescript
const html = ChadScript.embedFile("./index.html");
console.log(html); // contents of index.html, baked into the binary
```

The path must be a **string literal** (not a variable). It is resolved relative to the entry file being compiled.

## `ChadScript.embedDir(path)`

Recursively embed all files in a directory at compile time. Use `ChadScript.getEmbeddedFile()` to retrieve them at runtime.

```typescript
ChadScript.embedDir("./public");
```

This walks the directory tree and embeds every file it finds. Keys are relative paths within the embedded directory (e.g. `"images/logo.png"`).

## `ChadScript.getEmbeddedFile(key)`

Retrieve a previously embedded file by its key. For `embedFile()`, the key is the filename (basename). For `embedDir()`, the key is the relative path within the embedded directory.

```typescript
ChadScript.embedDir("./public");

const html   = ChadScript.getEmbeddedFile("index.html");
const css    = ChadScript.getEmbeddedFile("style.css");
const nested = ChadScript.getEmbeddedFile("images/logo.txt");
```

Returns an empty string if the key is not found.

## `ChadScript.getEmbeddedFileAsUint8Array(key)`

Retrieve a previously embedded file as a `Uint8Array`. Useful for binary data (hashing, writing to disk, building HTTP responses).

```typescript
ChadScript.embedDir("./assets");

const imageData: Uint8Array = ChadScript.getEmbeddedFileAsUint8Array("logo.png");
console.log(imageData.length);
fs.writeFileSync("/tmp/logo.png", imageData);
```

Returns a zero-length `Uint8Array` if the key is not found.

## `ChadScript.serveEmbedded(path)`

Return an `HttpResponse` for an embedded file. Strips the leading `/` from the path, looks up the file in the embedded table, and returns 200 + content if found or 404 if not. Content-Type is inferred automatically from the file extension (`.css`, `.js`, `.png`, `.wasm`, etc.).

This is a convenience wrapper for serving static assets from a web server — no per-file route boilerplate needed.

For full usage examples, see [HTTP Server — Serving files](./http-server.md#serving-files).

## API summary

| API | When | What |
|-----|------|------|
| `embedFile(path)` | Compile time | Reads one file, returns contents as string |
| `embedDir(path)` | Compile time | Recursively reads all files in directory |
| `getEmbeddedFile(key)` | Runtime | Looks up embedded content by filename/path |
| `getEmbeddedFileAsUint8Array(key)` | Runtime | Same, returns `Uint8Array` (binary-safe) |
| `serveEmbedded(path)` | Runtime | Returns `HttpResponse` for embedded file (200 or 404) |

## Notes

- All paths are resolved relative to the **entry file** (the `.ts` file passed to `chad build`)
- `embedFile()` and `embedDir()` arguments must be string literals — they are evaluated at compile time
- `embedDir()` keys are **relative paths** from the embedded directory (e.g. `subdir/page.html`), so files in different subdirectories with the same name won't collide
- `embedFile()` keys by **filename only** (basename) — avoid embedding two files with the same name via separate `embedFile()` calls; use `embedDir()` instead
- Binary files (images, fonts, wasm, etc.) are fully supported — embedded using Latin-1 encoding which preserves all byte values 0x00–0xFF

## How it works

At compile time, the compiler reads the file(s) from disk and emits them as LLVM IR global string constants. At runtime, `getEmbeddedFile()` does a linear strcmp lookup across all embedded keys — no filesystem access occurs.

See [`examples/apps/hackernews/`](https://github.com/cs01/ChadScript/tree/main/examples/apps/hackernews) for a working example with `embedDir()`.
