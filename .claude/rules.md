# ChadScript Rules

## Testing & Commit Workflow

After completing each todo:
1. Run unit tests
2. If tests pass, commit the changes
3. If tests fail, fix them before moving to the next todo
4. Never move on to the next todo while tests are failing

## Self-Hosting Verification

Before considering any feature complete, run the full self-hosting chain:
1. `npm run verify` — runs tests and self-hosting in parallel (preferred)
2. `npm run verify:quick` — same but skips Stage 2 (day-to-day dev)

Or manually:
1. `npm test` — all tests pass (auto-uses native compiler if `.build/chadc` exists)
2. `bash scripts/self-hosting.sh` — full 3-stage self-hosting
3. `bash scripts/self-hosting.sh --quick` — skip Stage 2

New features have complex side effects that may not be caught by unit tests alone. A change that passes all tests can still break self-hosting. The Stage 2 test is the true verification — it proves the compiler's output is correct enough to compile itself.

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
| `src/codegen/llvm-generator.ts` | Main orchestrator, delegates to sub-generators |
| `src/ast/types.ts` | AST node type definitions |
| `tests/compiler.test.ts` | Main test suite |
| `tests/fixtures/` | Test fixture programs organized by category |

## How to Add a New String Method

1. **IR Generation**: Add function in `src/codegen/types/collections/string/manipulation.ts` (or search.ts, etc.)
2. **Facade**: Add `doGenerateX()` in `src/codegen/types/collections/string.ts` (StringGenerator class)
3. **Dispatch**: Add `if (method === 'x')` block in `src/codegen/expressions/method-calls.ts` (~line 812 area)
4. **Handler**: Add `private handleX()` method in method-calls.ts
5. **Context**: If consumers access via a sub-generator context interface, ensure `readonly stringGen: IStringGenerator` is declared
6. **Test**: Add fixture in `tests/fixtures/strings/` and test case in `tests/compiler.test.ts`

**NOTE**: Prefer direct field access (`ctx.stringGen.doMethod()`) over adding wrapper methods to `IGeneratorContext`. Concrete type propagation in `loadFieldValue` (member.ts) ensures chained access through interface fields works in the native compiler.

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
Run tests + self-hosting: `npm run verify` (or `npm run verify:quick` to skip Stage 2)
Build: `npm run build` (TypeScript → dist/)

Tests auto-detect `.build/chadc` and use it instead of `node dist/chadc-node.js` (~10x faster per compile).
`compiler.test.ts` runs at concurrency 32; `smoke.test.ts` at concurrency 8.

## Useful Patterns

- `ctx.nextTemp()` — get next SSA temp variable name (%1, %2, etc.)
- `ctx.nextLabel(prefix)` — get next unique label for control flow
- `ctx.emit(line)` — emit a line of LLVM IR
- `ctx.generateExpression(expr, params)` — recursively generate an expression
- `ctx.setVariableType(name, type)` — tell the type system what type a temp is
- `createStringConstant(ctx, value)` — create a global string constant, returns i8*
- `GC_malloc_atomic(size)` — allocate GC'd memory for non-pointer data (strings)
- `GC_malloc(size)` — allocate GC'd memory that may contain pointers

## Terminator Classification

LLVM basic blocks must end with exactly one terminator instruction (`ret`, `br`, `unreachable`, `switch`).
Rather than parsing emitted strings to detect terminators, we use a parallel `outputIsTerminator: boolean[]`
that auto-classifies every instruction at `emit()` time. Use `ctx.lastInstructionIsTerminator()` to check.

**Three-way sync requirement**: The classification logic (`classifyTerminator`) exists in three places
that must stay identical: `BaseGenerator` (protected), `MockGeneratorContext` (private), and
`LLVMGenerator` inherits from `BaseGenerator`. If you add a new terminator (e.g., `invoke`, `indirectbr`),
update all three.

Builder methods (`emitRet`, `emitRetVoid`, `emitBr`, `emitBrCond`, `emitUnreachable`, `emitLabel`) are
available on `BaseGenerator`, `LLVMGenerator`, and `MockGeneratorContext` for type-safe terminator emission.

## Method Dispatch Flow

`method-calls.ts` → `generateMethodCall()` checks object type and method name:
1. Static methods first (Object.keys, Array.from, Promise.all, etc.)
2. Built-in objects (console, process, fs, path, JSON, Math, Date)
3. String methods (trim, indexOf, split, replace, etc.)
4. Array methods (push, pop, map, filter, find, etc.)
5. Map/Set methods
6. Class/interface method dispatch (vtable lookup)

## Codegen Quick Rules

1. **Hoist allocas to entry block** — never in conditional branches
2. **Store pointers as `i8*`** — `double` loses 64-bit precision
3. **Check class before interface** — try `findClassImplementingInterface()` BEFORE `interfaceStructGen.hasInterface()`
4. **Load array values in objects** — load the value, don't pass the alloca
5. **Type cast field order must match object literal order** — not TypeScript interface order
6. **`ret void` not `unreachable`** at end of void functions
7. **Class structs: boolean is `i1`; Interface structs: boolean is `double`**

## Patterns That Crash Native Code

1. **`new` in class field initializers is silently dropped** — codegen only emits type-based defaults. Move `new` calls to constructors. When removing a `new X()` initializer, you MUST add a constructor init.
2. **Optional chaining (`?.`) compiles to direct access** — ChadScript doesn't implement `?.`. Use explicit null checks.
3. **Type assertions must match real struct field order AND count** — `as { type, left, right }` on a struct that's `{ type, op, left, right }` causes GEP to read wrong fields. Fields must be a PREFIX of the real struct in EXACT order.

## Stage 0 Compatibility

Stage 0 can't handle `props[i].name` (array-of-objects field access). Use struct-of-arrays instead:
```typescript
// CRASHES: { name: string; type: string }[]
// WORKS:  { keys: string[]; types: string[] }  — then access props.keys[i]
```

## Async/Await Type Tracking

`allocateAwaitResult` in `variable-allocator.ts` must inspect the awaited expression to determine the correct SymbolKind. Default is `i8*`/string, but `Promise.all()` resolves to `%ObjectArray*`. For each new async API that resolves to a specific type, add a detection case to `allocateAwaitResult`.
