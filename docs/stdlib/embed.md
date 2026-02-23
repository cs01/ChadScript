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

Recursively embed all files in a directory at compile time. Each file is stored as a string constant keyed by its relative path within the directory.

```typescript
ChadScript.embedDir("./public");
```

This walks the directory tree and embeds every file it finds. Use `getEmbeddedFile()` to retrieve them at runtime.

## `ChadScript.getEmbeddedFile(key)`

Retrieve a previously embedded file by its key. For `embedFile()`, the key is the filename. For `embedDir()`, the key is the relative path within the embedded directory.

```typescript
ChadScript.embedDir("./public");

const html = ChadScript.getEmbeddedFile("index.html");
const css = ChadScript.getEmbeddedFile("style.css");
const nested = ChadScript.getEmbeddedFile("images/logo.txt");
```

Returns an empty string if the key is not found.

## `ChadScript.serveEmbedded(path)`

Return an `HttpResponse` for an embedded file. Strips the leading `/` from the path, looks up the file in the embedded table, and returns `{ status: 200, body: content, headers: "" }` if found or `{ status: 404, body: "Not Found", headers: "" }` if not.

This eliminates per-file route boilerplate for serving static assets:

```typescript
ChadScript.embedDir("./public");

function handleRequest(req: HttpRequest): HttpResponse {
  if (req.path.startsWith("/api/")) return handleApi(req);
  return ChadScript.serveEmbedded(req.path);
}

httpServe(3000, handleRequest);
```

## Example: HTTP Server with Embedded Files

A common pattern is embedding HTML/CSS for a web server so the entire app is a single binary with no external file dependencies:

```
my-server/
  app.ts
  public/
    index.html
    style.css
```

```typescript
ChadScript.embedDir("./public");

function handleRequest(req: HttpRequest): HttpResponse {
  // Serve all embedded files with a single line
  return ChadScript.serveEmbedded(req.path);
}

httpServe(3000, handleRequest);
```

Or with manual routing for more control:

```typescript
ChadScript.embedDir("./public");

function handleRequest(req: HttpRequest): HttpResponse {
  if (req.path == "/") {
    return { status: 200, body: ChadScript.getEmbeddedFile("index.html"), headers: "" };
  }
  if (req.path == "/style.css") {
    return { status: 200, body: ChadScript.getEmbeddedFile("style.css"), headers: "Content-Type: text/css" };
  }
  return { status: 404, body: "Not Found", headers: "" };
}

httpServe(3000, handleRequest);
```

```bash
$ chad build my-server/app.ts -o server
$ ./server
# HTML and CSS are served from memory — no files needed at runtime
```

See [`examples/hackernews/`](https://github.com/cs01/ChadScript/tree/main/examples/hackernews) for a full working example with `embedDir()`.

## How It Works

At compile time, the compiler reads the file(s) from disk and emits them as LLVM IR global string constants. At runtime, `getEmbeddedFile()` does a simple string comparison lookup across all embedded keys — no file system access occurs.

| API | When | What |
|-----|------|------|
| `embedFile(path)` | Compile time | Reads file, returns contents as string |
| `embedDir(path)` | Compile time | Recursively reads all files in directory |
| `getEmbeddedFile(key)` | Runtime | Looks up embedded content by filename/path |
| `serveEmbedded(path)` | Runtime | Returns HttpResponse for embedded file (200 or 404) |

## Notes

- All paths are resolved relative to the **entry file** (the `.ts` file passed to `chad build`)
- `embedFile()` and `embedDir()` arguments must be string literals — they are evaluated at compile time
- `embedDir()` embeds all files recursively; keys are **relative paths** from the embedded directory (e.g. `subdir/page.html`), so files with the same name in different subdirectories won't collide
- `embedFile()` keys by **filename only** (basename), so avoid embedding two files with the same name via separate `embedFile()` calls — use `embedDir()` instead when you have nested structures
- Binary files are read as UTF-8; this is designed for text content
