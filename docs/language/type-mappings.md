# Type Mappings

Every TypeScript type maps to exactly one concrete LLVM representation at compile time — no boxing, no type tags, no runtime type checks.

## Primitive Types

| TypeScript | LLVM IR | Notes |
|---|---|---|
| `number` | `double` | 64-bit IEEE 754 float — all numbers, no ints |
| `boolean` | `double` | `1.0` = true, `0.0` = false |
| `string` | `i8*` | Null-terminated C string (`char*`), GC'd |
| `void` | `void` | |
| `null` | `null` (`i8*`) | Null pointer |

## Collection Types

| TypeScript | LLVM IR | Notes |
|---|---|---|
| `number[]` | `%Array*` | `{ double*, i32, i32 }` — data, length, capacity |
| `string[]` | `%StringArray*` | `{ i8**, i32, i32 }` — data, length, capacity |
| `SomeClass` | `%SomeClass_struct*` | Heap-allocated struct via `GC_malloc` |
| `Uint8Array` | `%Uint8Array*` | `{ i8*, i32, i32 }` — data, length, capacity |
| `Map<string, V>` | `%StringMap*` | `{ i8**, i8**, i32, i32 }` — parallel arrays |

## API Mappings

Node.js APIs map to native equivalents, inlined directly as LLVM IR at the call site:

| Node.js API | Native Implementation |
|---|---|
| `console.log()` | `printf()` |
| `fs.readFileSync()` | `fopen()` + `fread()` |
| `fs.writeFileSync()` | `fopen()` + `fwrite()` |
| `JSON.parse<T>()` | cJSON library (generated per-type parser) |
| `fetch()` | libcurl + libuv thread pool |
| `Math.floor()` etc. | LLVM intrinsics (`@llvm.floor.f64`) |
| `process.argv` | C `main(argc, argv)` |
| `process.exit()` | `exit()` |
| `process.uptime()` | `clock_gettime(CLOCK_MONOTONIC)` |
| `tty.isatty()` | `isatty()` |
| `child_process.execSync()` | `popen()` + `fread()` |
| `crypto.sha256()` etc. | OpenSSL EVP API (`libcrypto`) |
| `sqlite.open()` etc. | `libsqlite3` |

## Key Differences from TypeScript

- **No `any` or `unknown`** — every value has a concrete type at compile time
- **`boolean` is `double`** — `1.0` for true, `0.0` for false (no separate `i1` at the ABI level)
- **Strings are C strings** — null-terminated `i8*`, not JavaScript string objects
- **No boxing** — primitives are never wrapped in objects
- **No tagged unions** — `string | number` is rejected at compile time; `string | null` works because both are `i8*`
