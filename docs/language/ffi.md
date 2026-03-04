# Foreign Function Interface (FFI)

ChadScript compiles to LLVM IR, which can call any C function by declaring its signature. At link time, the linker resolves the symbol from a `.o` file or system library and bakes the address directly into the binary. There is no FFI layer, no marshalling, and no runtime overhead — it's a direct native call, the same as calling the function from C.

`declare function` is how you expose a C function to ChadScript:

```ts
declare function zr_init(): i8_ptr;
declare function zr_draw_text(engine: i8_ptr, x: i32, y: i32, text: i8_ptr, fg: u32, bg: u32): void;
```

## Type Aliases

FFI type aliases map directly to LLVM types:

| Type Alias | LLVM Type | Description |
|-----------|-----------|-------------|
| `i8`, `i16`, `i32`, `i64` | `i8`, `i16`, `i32`, `i64` | Signed integers |
| `u8`, `u16`, `u32`, `u64` | `i8`, `i16`, `i32`, `i64` | Unsigned integers (same LLVM type) |
| `f32` | `float` | 32-bit float |
| `f64` | `double` | 64-bit float |
| `i8_ptr`, `ptr` | `i8*` | Opaque pointer |

## Linking External Objects

Link external object files or static libraries with `--link-obj`:

```bash
chad build app.ts -o app --link-obj bridge.o --link-obj /path/to/libfoo.a
```

Linker flags (`-lm`, `-lpthread`, etc.) are auto-detected from linked libraries.

## Example

```ts
declare function sqlite3_open(path: i8_ptr, db: i8_ptr): i32;
declare function sqlite3_exec(db: i8_ptr, sql: i8_ptr, cb: i8_ptr, arg: i8_ptr, err: i8_ptr): i32;
declare function sqlite3_close(db: i8_ptr): i32;
```

The `declare` tells the compiler the C function signature. The linker resolves the symbol at build time — at runtime the address is baked into the binary with no dynamic dispatch.
