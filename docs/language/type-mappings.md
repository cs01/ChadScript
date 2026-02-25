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

## FFI Types (`declare function`)

These type aliases are used in `declare function` signatures for zero-cost C interop. They map directly to LLVM integer/float types — no double conversion overhead.

| Type Alias | LLVM IR | Notes |
|---|---|---|
| `i8`, `i16`, `i32`, `i64` | `i8`, `i16`, `i32`, `i64` | Signed integers |
| `u8`, `u16`, `u32`, `u64` | `i8`, `i16`, `i32`, `i64` | Unsigned (same LLVM representation) |
| `f32` | `float` | 32-bit float |
| `f64` | `double` | 64-bit float (same as `number`) |
| `i8_ptr`, `ptr` | `i8*` | Opaque pointer (same as `string`) |

In regular ChadScript code, all numbers are `double`. FFI types are only meaningful in `declare function` parameter/return types — they tell the compiler to emit native-width arguments instead of converting through `double`.

## Key Differences from TypeScript

- **No `any` or `unknown`** — every value has a concrete type at compile time
- **`boolean` is `double`** — `1.0` for true, `0.0` for false (no separate `i1` at the ABI level)
- **Strings are C strings** — null-terminated `i8*`, not JavaScript string objects
- **No boxing** — primitives are never wrapped in objects
- **No tagged unions** — `string | number` is rejected at compile time; `string | null` works because both are `i8*`
