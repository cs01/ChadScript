# ChadScript

**Compile High-speed Apps Directly — from TypeScript to native binaries. No runtime.**

ChadScript compiles TypeScript directly to native machine code via LLVM IR. No Node.js, no V8, no interpreter. The output is a standalone ELF binary.

```bash
$ chad build examples/hello.ts -o /tmp/hello

$ time /tmp/hello
Hello from ChadScript!
This is native code - no Node.js runtime!

real	0m0.008s

$ file /tmp/hello
/tmp/hello: ELF 64-bit LSB executable, x86-64
```

### Self-Hosting

ChadScript is self-hosting — the compiler is written in TypeScript and can compile itself into a native binary. That native binary can then compile other programs without Node.js installed at all. This means ChadScript is expressive enough to implement a ~45k-line compiler with multi-file imports, LLVM IR generation, and full AST processing.

## Why ChadScript?

ChadScript compared to...

**Node.js / Deno / Bun** — No runtime, no `node_modules`, no cold start penalty. Ship a single binary that starts in under 10ms. Ideal for CLI tools, microservices, and edge deployments where container size and startup time matter.

**Rust / C / C++** — You already know the syntax. No borrow checker, no header files, no makefiles. ChadScript targets developers who want native performance without learning a new language. Write the TypeScript you know, get the binary you need.

**Go** — TypeScript syntax instead of Go's idiosyncratic type system. Classes, generics, interfaces, and async/await work the way you expect. Same single-binary deployment story, familiar language.

ChadScript is not a drop-in replacement for TypeScript - it's a compiled language that uses TypeScript syntax.

## Non-Goals

- **npm compatibility** — ChadScript is not a Node.js replacement. npm packages assume V8 semantics, a specific GC model, and Node APIs.
- **Full TypeScript compatibility** — ChadScript uses TypeScript syntax but is a different language with different semantics. Features like `any`, `unknown`, conditional types, and mapped types don't have meaningful native representations.
- **REPL / interpreter mode** — ChadScript compiles to native code.


## Quick Start

### Install

Download the latest release from [GitHub Releases](https://github.com/cs01/ChadScript/releases), extract it, and add it to your PATH.

You'll also need LLVM, clang, and libcurl on your system:

```bash
# Ubuntu/Debian
sudo apt-get install llvm clang libcurl4-openssl-dev

# RHEL/Fedora
sudo dnf install llvm clang libcurl-devel

# macOS
brew install llvm
export PATH="/opt/homebrew/opt/llvm/bin:$PATH"
```

To build from source instead, see [BUILDING.md](BUILDING.md).

### Compile and Run

```bash
chad build examples/hello.ts
.build/examples/hello
```

Or compile and run in one step:

```bash
chad run examples/hello.ts
```

### CLI

```
chad <command> [options] <file>

Commands:
  build <file>     Compile to a native binary
  run <file>       Compile and run
  ir <file>        Emit LLVM IR only
  clean            Remove the .build directory

Options:
  -o <output>      Specify output file (default: .build/<input>)
  -v, --verbose    Show compilation steps
  --debug          Show internal debugging info
  --trace          Show everything (AST, IR, variable tracking)
  --target <triple> Cross-compile for a different platform (planned)
                    e.g. x86_64-linux-gnu, aarch64-linux-gnu
```

The bare compiler is also available as `chadc`:

```bash
chadc hello.ts              # same as chad build hello.ts
chadc hello.ts -o myapp     # same as chad build hello.ts -o myapp
```

## Batteries Included

ChadScript ships with a full standard library — HTTP servers, file I/O, JSON parsing, async timers, regex, and more — all compiled to native code. No npm, no node_modules, no bundler. Write TypeScript, get a single binary with everything built in.

**Core language:** functions, variables (`const`/`let`), arithmetic/logic operators, control flow (`if`/`else`/`while`/`for`/`for...of`), try/catch/throw, ternary expressions, classes with inheritance, enums, destructuring (`const { a, b } = obj`, `const [x, y] = arr`), spread (`[...arr1, ...arr2]`), rest parameters (`...args`)

**Type system:** interfaces compile to native structs, type annotations, generics (`Map<K,V>`, `Set<T>`, `Array<T>`), import/export modules

**Standard library:**

| Module | APIs |
|--------|------|
| `console` | `log`, `error` |
| `process` | `argv`, `exit`, `env`, `platform`, `arch`, `version`, `pid`, `ppid`, `execPath`, `argv0`, `chdir`, `abort`, `kill`, `uptime`, `getuid`, `getgid`, `geteuid`, `getegid`, `stdout.write`, `stderr.write` |
| `fs` | `readFileSync`, `writeFileSync`, `existsSync`, `unlinkSync` |
| `path` | `join`, `resolve`, `dirname`, `basename` |
| `Math` | `floor`, `ceil`, `round`, `abs`, `min`, `max`, `sqrt`, `pow`, `random`, `PI`, `E`, `log`, `log2`, `log10`, `sin`, `cos`, `tan` |
| `JSON` | `parse<T>`, `stringify` |
| `String` | `length`, `split`, `indexOf`, `includes`, `slice`, `substr`, `trim`, `trimStart`, `trimEnd`, `padStart`, `repeat`, `concat`, `replace`, `replaceAll`, `startsWith`, `endsWith`, `charAt` |
| `Number` | `isFinite`, `isNaN`, `isInteger`, `toString` |
| `Array` | `length`, `push`, `pop`, `shift`, `map`, `filter`, `find`, `forEach`, `some`, `includes`, `slice`, `indexOf`, `join`, `concat`, `splice`, `reduce`, `isArray` |
| `Map` | `set`, `get`, `has`, `delete`, `size`, `keys`, `values` |
| `Set` | `add`, `has`, `delete`, `size` |
| `RegExp` | `test` |
| `Object` | `keys`, `values`, `entries` |
| `tty` | `isatty` |
| Networking | `fetch` (async, libcurl), `httpServe` |
| Async | `async`/`await`, `Promise.all`, `Promise.race`, `setTimeout`, `setInterval` |
| Other | `parseInt`, `Date.now`, `child_process.execSync` |

## Examples

**HTTP server in one file** — compiles to a native binary, serves a styled welcome page:

```typescript
// http-server.ts
function homeHandler(req: Request): Response {
  return { status: 200, body: "<h1>Hello from ChadScript</h1>" };
}

function jsonHandler(req: Request): Response {
  return { status: 200, body: '{"message":"hello","count":42}' };
}

function handleRequest(req: Request): Response {
  if (req.method == "GET") {
    if (req.path == "/") return homeHandler(req);
    if (req.path == "/json") return jsonHandler(req);
  }
  return { status: 404, body: "Not Found" };
}

httpServe(3000, handleRequest);
```

```bash
$ chad build examples/http-server.ts
$ .build/examples/http-server &
$ curl http://localhost:3000/json
{"message":"hello","count":42}
```

**HTTP client** — `fetch` is built in too, backed by libcurl:

```typescript
const response = await fetch("https://api.github.com/repos/cs01/ChadScript");
const data = response.json<Repo>();
console.log(data.name);
```

**CLI tool** — read files, parse arguments, process text:

```typescript
// word-count.ts
function countStats(content: string): void {
  const words = content.split(" ");
  console.log("Words: ");
  console.log(words.length);
}

const filename = process.argv[0];
const content = fs.readFileSync(filename);
countStats(content);
```

```bash
$ chad build word-count.ts
$ .build/word-count README.md
Words: 437
```

See `examples/` for more: CLI argument parsing, async timers, HTTP routing.

## Type Mappings

Every TypeScript type maps to exactly one concrete LLVM representation at compile time — no boxing, no type tags, no runtime type checks.

| TypeScript | LLVM IR | Notes |
|---|---|---|
| `number` | `double` | 64-bit IEEE 754 float — all numbers, no ints |
| `boolean` | `double` | `1.0` = true, `0.0` = false |
| `string` | `i8*` | Null-terminated C string (`char*`) |
| `void` | `void` | |
| `null` | `null` (`i8*`) | Null pointer |
| `number[]` | `%Array*` | `{ double*, i32, i32 }` — data, length, capacity |
| `string[]` | `%StringArray*` | `{ i8**, i32, i32 }` — data, length, capacity |
| `SomeClass` | `%SomeClass_struct*` | Heap-allocated struct via `GC_malloc` |
| `Map<string, V>` | `%StringMap*` | `{ i8**, i8**, i32, i32 }` — parallel arrays |

Node.js APIs map to native equivalents — inlined directly as LLVM IR at the call site:

| Node.js API | Native implementation |
|---|---|
| `console.log()` | `printf()` |
| `fs.readFileSync()` | `fopen()` + `fread()` |
| `fs.writeFileSync()` | `fopen()` + `fwrite()` |
| `JSON.parse()` | cJSON library |
| `fetch()` | libcurl + libuv thread pool |
| `Math.floor()` etc. | LLVM intrinsics (`@llvm.floor.f64`) |
| `process.argv` | C `main(argc, argv)` |
| `process.exit()` | `exit()` |
| `process.uptime()` | `clock_gettime(CLOCK_MONOTONIC)` |
| `tty.isatty()` | `isatty()` |
| `child_process.execSync()` | `popen()` + `fread()` |

## Limitations

- **No discriminated unions** - Types map to fixed LLVM representations (`string` → `i8*`, `number` → `double`). `string | null` works (same repr), but `string | number` is rejected at compile time. Tagged unions may come later.
- **No dynamic features** - No `eval`, optional chaining, or runtime type manipulation
- **No reflection** - No `instanceof`, `for...in`, runtime type inspection
- **No user-defined generics** - Built-in generics (`Map<K,V>`, `Array<T>`, `.json<T>()`) work, but you can't define your own generic functions or classes yet

## Architecture

```
TypeScript source
    → TypeScript Compiler API (parse + type info)
    → AST
    → Semantic analysis
    → LLVM IR generation
    → llc (LLVM IR → object file)
    → clang (link against libgc, libcurl, libcjson, libuv, mongoose)
    → native binary
```

The compiler is ~45k lines of TypeScript across ~70 source files in `src/`.

## Development

See [BUILDING.md](BUILDING.md) for full build-from-source instructions.

```bash
npm install
bash scripts/build-vendor.sh
npm run build
npm test
```

## License

MIT
