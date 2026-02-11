# ChadScript Rules

## Testing & Commit Workflow

After completing each todo:
1. Run unit tests
2. If tests pass, commit the changes
3. If tests fail, fix them before moving to the next todo
4. Never move on to the next todo while tests are failing

## Self-Hosting Verification

Before considering any feature complete, run the full self-hosting chain:
1. `npm test` — all tests pass
2. `npm run build && node dist/index.js --link-tree-sitter src/native-compiler.ts -o .build/chadc` — rebuild Stage 0
3. `.build/chadc examples/hello.ts -o /tmp/hello && /tmp/hello` — Stage 0 smoke test
4. `.build/chadc src/native-compiler.ts -o /tmp/chad-stage1` — Stage 0 compiles itself (Stage 1)
5. `/tmp/chad-stage1 examples/hello.ts -o /tmp/hello2 && /tmp/hello2` — Stage 1 smoke test
6. `/tmp/chad-stage1 src/native-compiler.ts -o /tmp/chad-stage2` — Stage 1 compiles itself (Stage 2)
7. `/tmp/chad-stage2 examples/hello.ts -o /tmp/hello3 && /tmp/hello3` — Stage 2 smoke test

New features have complex side effects that may not be caught by unit tests alone. A change that passes all 240 tests can still break self-hosting. The Stage 2 test is the true verification — it proves the compiler's output is correct enough to compile itself.

## Stage 0 Compatibility - STOP Adding Wrapper Methods

The wrapper method pattern for Stage 0 compatibility is NOT scalable. Do NOT add more wrapper methods like:
- `ctx.fooGenMethod()` instead of `ctx.fooGen.method()`
- `symbolTableIsX()` instead of `symbolTable.isX()`
- `typeResolverGetX()` instead of `typeResolver.getX()`

The generator-context.ts file already has ~195 wrapper methods. This O(n*m) pattern makes the codebase unmaintainable.

**What to do instead:**
1. If Stage 0 crashes on chained access, investigate the root cause in member.ts/method-calls.ts
2. Fix the type tracking for intermediate pointer values
3. Store concrete type information alongside i8* pointers
4. See LEARNINGS.md section "Interface Method Dispatch Struct Layout Mismatch"

**Root cause**: Stage 0 loses type information when accessing a field that returns an interface pointer (i8*). The proper fix is to track the concrete type, not to flatten all method calls.

# ChadScript Architecture Guide

## What It Is
TypeScript-to-native compiler using LLVM IR. Compiles .ts/.js files to native binaries via: Parser → AST → Semantic Analysis → LLVM IR Codegen → llc (assembler) → clang (linker) → native binary.

## Key Directories

| Dir | Purpose |
|-----|---------|
| `src/codegen/` | LLVM IR code generation (the core) |
| `src/codegen/expressions/method-calls.ts` | Central dispatcher for all `object.method()` calls |
| `src/codegen/types/collections/string/` | String method IR generators (manipulation.ts, search.ts, split.ts, etc.) |
| `src/codegen/types/collections/string.ts` | `StringGenerator` facade that delegates to sub-modules |
| `src/codegen/types/collections/array.ts` | Array method IR generators (push, pop, map, filter, etc.) |
| `src/codegen/types/collections/array/` | Array sub-modules (mutators.ts) |
| `src/codegen/stdlib/` | Built-in module generators (console.ts, process.ts, fs.ts, math.ts, etc.) |
| `src/codegen/infrastructure/` | Core: generator-context.ts, symbol-table.ts, type-resolver.ts |
| `src/codegen/llvm-generator.ts` | Main orchestrator, has all wrapper methods |
| `src/ast/types.ts` | AST node type definitions |
| `tests/compiler.test.ts` | Main test suite |
| `tests/fixtures/` | Test fixture programs organized by category |

## How to Add a New String Method

1. **IR Generation**: Add function in `src/codegen/types/collections/string/manipulation.ts` (or search.ts, etc.)
2. **Facade**: Add `doGenerateX()` in `src/codegen/types/collections/string.ts` (StringGenerator class)
3. **Dispatch**: Add `if (method === 'x')` block in `src/codegen/expressions/method-calls.ts` (~line 812 area)
4. **Handler**: Add `private handleX()` method in method-calls.ts
5. **Wrapper**: Add to `IGeneratorContext` interface in `src/codegen/infrastructure/generator-context.ts` and `llvm-generator.ts`
6. **Test**: Add fixture in `tests/fixtures/strings/` and test case in `tests/compiler.test.ts`

**NOTE**: Per project rules, avoid adding new wrapper methods where possible. The `generator-context.ts` already has ~195 wrappers.

## How to Add a New Built-in (process.x, console.x, etc.)

1. Check if existing generator handles it (e.g., `src/codegen/stdlib/process.ts`)
2. Most built-ins are handled inline in `method-calls.ts` for performance
3. For member access (not method calls), look at `src/codegen/expressions/member.ts`
4. Test: add fixture in `tests/fixtures/builtins/`

## Struct Types

| LLVM Type | JS Type |
|-----------|---------|
| `%Array = type { double*, i32, i32 }` | `number[]` (data ptr, length, capacity) |
| `%StringArray = type { i8**, i32, i32 }` | `string[]` |
| `%ObjectArray = type { i8*, i32, i32 }` | `object[]` |
| `i8*` | `string` (null-terminated C string) |
| `double` | `number` |
| `i1` | `boolean` |

## Test Patterns

Tests use two conventions:
- `expectTestPassed: true` — program prints `TEST_PASSED` to stdout, exits 0
- `expectedExitCode: N` — program exits with specific code

Run tests: `npm test` or `npm run test:full` (via `node scripts/test.js`)
Build: `npm run build` (TypeScript → dist/)

## Useful Patterns

- `ctx.nextTemp()` — get next SSA temp variable name (%1, %2, etc.)
- `ctx.nextLabel(prefix)` — get next unique label for control flow
- `ctx.emit(line)` — emit a line of LLVM IR
- `ctx.generateExpression(expr, params)` — recursively generate an expression
- `ctx.setVariableType(name, type)` — tell the type system what type a temp is
- `createStringConstant(ctx, value)` — create a global string constant, returns i8*
- `GC_malloc_atomic(size)` — allocate GC'd memory for non-pointer data (strings)
- `GC_malloc(size)` — allocate GC'd memory that may contain pointers

## Method Dispatch Flow

`method-calls.ts` → `generateMethodCall()` checks object type and method name:
1. Static methods first (Object.keys, Array.from, Promise.all, etc.)
2. Built-in objects (console, process, fs, path, JSON, Math, Date)
3. String methods (trim, indexOf, split, replace, etc.)
4. Array methods (push, pop, map, filter, find, etc.)
5. Map/Set methods
6. Class/interface method dispatch (vtable lookup)
