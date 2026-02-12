# Architecture

ChadScript compiles TypeScript source code to native binaries through a multi-stage pipeline.

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

The TypeScript Compiler API (`tsc`) parses the source file and provides:
- Full AST with type annotations
- Type resolution for variables, parameters, and return types
- Import/export resolution across files

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
chadc --link-tree-sitter src/native-compiler.ts -o chad-stage0

# Stage 1: The native binary compiles itself (no Node.js needed)
./chad-stage0 src/native-compiler.ts -o chad-stage1

# Stage 2: Verify correctness (Stage 1 output == Stage 2 output)
./chad-stage1 src/native-compiler.ts -o chad-stage2
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
