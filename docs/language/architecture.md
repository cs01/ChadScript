# Architecture

ChadScript compiles TypeScript source code to native binaries through a multi-stage pipeline.

::: tip Self-Hosting
ChadScript compiles itself, meaning it is sufficiently powerful to build a complex compiler. The compiler is ~45k lines of TypeScript that compiles to a native binary — no Node.js needed.
:::

## Compilation Pipeline

```
TypeScript source
    -> TypeScript Compiler API (parse + type info)
    -> AST
    -> Semantic analysis
    -> LLVM IR generation
    -> llc (LLVM IR -> object file)
    -> clang (link against system libraries)
    -> native binary
```

## Pipeline Stages

### 1. Parsing

ChadScript has two parser frontends depending on the compilation path:

**Node.js path** (development): Uses the TypeScript Compiler API (`typescript` npm package) to parse source files. This provides a full AST with type annotations, type resolution for variables and parameters, and import/export resolution. The parser lives in `src/parser-ts/`.

**Native path** (self-hosting): Uses [tree-sitter](https://tree-sitter.github.io/) via C FFI to parse TypeScript. The tree-sitter grammar produces a concrete syntax tree that is then transformed into ChadScript's internal AST. The parser lives in `src/parser-native/`.

Both paths produce the same AST structure — the rest of the pipeline is shared.

### 2. Type Checking

The two compilation paths handle type resolution differently:

**Node.js path**: Creates a `TypeChecker` instance that wraps TypeScript's own `ts.TypeChecker`. This provides property type resolution, function signature lookup, interface definition extraction, and array element type inference. The TypeChecker is passed to the code generator as a supplementary source of type information alongside AST-level annotations. It is only created for `.ts` files — `.js` files rely entirely on AST-level inference.

**Native path**: Passes `null` as the TypeChecker to the code generator. Since the TypeScript compiler API can't run natively, the native path relies entirely on:

- **AST-level type annotations** extracted by the tree-sitter parser (parameter types, return types, field types)
- **InterfaceStructGenerator** for building struct layouts from interface declarations
- **ClassGenerator** field tracking from AST class declarations
- **Type inference** from context (string literals produce `i8*`, numeric operations produce `double`, etc.)

The practical effect is that code compiled via the native path needs more explicit type annotations. This is why the compiler's own source code is heavily annotated — it must work correctly without TypeScript's type inference engine.

### 2. AST Processing

The AST is walked and transformed:
- Type annotations are resolved to LLVM types
- Class hierarchies are analyzed for vtable layout
- Interface types are mapped to struct definitions
- Import graphs are resolved for multi-file compilation

### 3. LLVM IR Generation

The core of ChadScript. Each AST node is lowered to LLVM IR:
- Functions become LLVM functions
- Variables become SSA temporaries or `alloca` stack slots
- Method calls are dispatched through type-specific code generators
- Built-in APIs are inlined as LLVM IR at the call site

### 4. Assembly & Linking

```bash
llc output.ll -o output.o          # LLVM IR -> object file
clang output.o -o binary \         # Link against system libraries
  -lgc -lcjson -luv -lcurl \
  -lcrypto -lsqlite3 -lm -lpthread
```

## Linked Libraries

| Library | Purpose |
|---------|---------|
| `libgc` (Boehm GC) | Garbage collection |
| `libcjson` | JSON parsing |
| `libuv` | Event loop, async timers |
| `libcurl` | HTTP client (`fetch`) |
| `libcrypto` (OpenSSL) | Hashing, random bytes |
| `libsqlite3` | SQLite database |
| `mongoose` | HTTP server |
| `libm` | Math functions |
| `libpthread` | Threading |

## Self-Hosting

ChadScript is self-hosting — the compiler (~45k lines of TypeScript across ~70 source files) can compile itself:

```bash
# Stage 0: Node.js compiles the compiler to a native binary
chadc src/chadc-native.ts -o chad-stage0

# Stage 1: The native binary compiles itself (no Node.js needed)
./chad-stage0 src/chadc-native.ts -o chad-stage1

# Stage 2: Verify correctness (Stage 1 output == Stage 2 output)
./chad-stage1 src/chadc-native.ts -o chad-stage2
```

The Stage 2 binary proves the compiler's output is correct enough to reproduce itself.

## Source Structure

| Directory | Purpose |
|-----------|---------|
| `src/codegen/` | LLVM IR code generation |
| `src/codegen/expressions/` | Expression codegen (method calls, member access, binary ops) |
| `src/codegen/types/collections/` | String, Array, Map, Set IR generators |
| `src/codegen/stdlib/` | Built-in module generators (console, process, fs, etc.) |
| `src/codegen/infrastructure/` | Core infrastructure (generator context, symbol table, type resolver) |
| `src/ast/` | AST type definitions |
| `tests/` | Test suite and fixtures |
