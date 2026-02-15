# ChadScript Self-Hosting Learnings

## Quick Rules

1. **Hoist allocas to entry block** — not in conditional branches
2. **Store pointers as `i8*`** — `double` loses 64-bit precision
3. **Check class before interface** — try `findClassImplementingInterface()` BEFORE `interfaceStructGen.hasInterface()`
4. **Load array values in objects** — load the value, don't pass the alloca
5. **Type cast field order must match object literal order** — not TypeScript interface order
6. **`ret void` not `unreachable`** at end of void functions
7. **Class structs → boolean is `i1`; Interface structs → boolean is `double`**
8. **Self-hosting verification is non-negotiable** — 240 passing tests don't guarantee Stage 1→2 works

## 🚨 Interface Method Dispatch Struct Layout Mismatch

When a class instance is stored in an interface-typed variable, calling methods crashes because interface structs have fewer fields than class structs. Bitcasting between them causes out-of-bounds GEP field access.

**Previous workaround:** Wrapper/delegate methods (e.g., `symbolTableIsClass(name)` instead of `symbolTable.isClass(name)`). **⚠️ NOT SCALABLE** — generator-context.ts had ~195 wrappers.

**Fix implemented:** Concrete type propagation in `loadFieldValue` (member.ts). When a field is loaded as `i8*` but the field's `tsType` is a known class name in the AST, `setActualClassType` is called to record the concrete type. This allows subsequent method dispatch to find the correct vtable entry via `getActualClassType`. All `symbolTableIs*` wrappers (14 methods) have been removed and replaced with direct `ctx.symbolTable.isXxx()` chained access, verified through Stage 2 self-hosting.

**Remaining work:** ~180+ wrappers remain for other sub-generators (`symbolTableGet*`, `typeResolverXxx`, `classGenXxx`, `stringGenXxx`, `arrayGenXxx`, `mapGen/setGen`, etc.). These can be removed incrementally using the same pattern — each batch should pass the full self-hosting chain before committing.

## 🔀 Duplicate Code Paths — `generate()` vs `generateParts()`

These were 150+ line copy-pastes. When tree-sitter auto-detection was added to `generate()`, it was never added to `generateParts()`, causing Stage 1 to produce IR missing `@__ts_*` declarations.

**Fix:** `generate()` delegates to `generateParts().join('')`. **Rule:** When you find duplicate methods with different return types, consolidate immediately.

## 📐 Struct-of-Arrays Pattern for Stage 0

Stage 0 can't handle `props[i].name` (array-of-objects field access). Replace with struct-of-arrays:

```typescript
// CRASHES: { name: string; type: string }[]
// WORKS:  { keys: string[]; types: string[] }  — then access props.keys[i]
```

Applied in commit 587eef57 to: `getInterfaceProperties`, `getTypeAliasCommonProperties`, `getBuiltinAstTypeFields`, `getMethodCallArrayReturn`.

Same commit also applied:
- Enum types widened to `number` (Stage 0 enum dispatch issues)
- String literal unions widened to `string`
- Regex replaced with parsing functions (`parseMapTypeString()`, etc.)
- Method return values stored in locals before returning (avoids chained return type loss)

## 🐛 Three Patterns That Crash Native Code

### 1. `new` in class field initializers is silently dropped

Codegen only emits type-based defaults for fields (null/0.0). Move `new` calls to constructors or local variables. **Also hit:** `SemanticAnalyzer.symbols` and `ClosureAnalyzer.declaredVars` — when removing a `new X()` initializer, you MUST add a constructor init.

### 2. Optional chaining (`?.`) compiles to direct access

ChadScript doesn't implement `?.`. Use explicit null checks: `obj ? obj.field : undefined`.

### 3. Type assertions must match real struct field order AND count

`as { type, left, right }` on a struct that's actually `{ type, op, left, right }` causes GEP to read wrong fields. Fields must be a PREFIX of the real struct in EXACT order. Common culprits: `BinaryNode` (has `op`), `UnaryNode` (has `op`), `InterfaceDeclaration` (has `extends`), `MethodCallNode` (has `method`), `ForOfStatement` (has `variableKind`, `variableName`, `destructuredNames`), `FunctionParameter` (4 fields).

### Debugging native segfaults

```bash
gdb -batch -ex "run examples/hello.ts" -ex "bt" ./.build/src/native-compiler
grep -A30 "define.*@ClassName_methodName" .build/src/native-compiler.ll
grep -E "^%StructName" .build/src/native-compiler.ll
python3 -c "import struct; print(struct.pack('<Q', 0x746c75736572).decode('ascii', errors='replace'))"
```

## 🐛 Boolean Field Type Mismatch (i1 vs double)

Interface structs store booleans as `double` (via `tsTypeToLlvm`), but codegen was emitting `load i1`/`store i1`. `load i1` from `double 1.0` reads `0x00` = false. This made `isPointerAlloca` always false, causing 16-byte structs written into 8-byte allocas.

**Fixed in:** `member.ts` (3 locations), `json.ts`, `response.ts`.

## 🐛 Untyped Function Params → `i8*` Instead of `double`

Tree-sitter pushed `'any'` for untyped params; codegen treated `'any'` as non-primitive → `i8*`. TS parser pushed `undefined` which triggered the `'double'` default backfill.

**Fix:** (1) `transformer.ts` pushes `'number'` for untyped params, (2) `function-generator.ts` rejects `'any'`/`'unknown'` at codegen, (3) `binary.ts` coerces `i8*`→`double` as defense-in-depth (duct tape — masks upstream bugs).

**Note:** `extractParamTypes`/`extractParamNames` walk the same AST independently and must stay in sync. Consider merging into `extractParams() → { names, types }`.

## 🏗️ Architecture Pain Points

1. **function-generator.ts has two identical type-mapping chains** (Path A ~line 86, Path B ~line 120). Extract to shared function.
2. **Stage 0 inline function expressions crash.** `arr.map(function(x) { ... })` segfaults; named function refs work. Likely AST representation issue for anonymous functions.
3. **`extractParamTypes`/`extractParamNames` split is fragile** — see note above.

## 🔄 Async Function Return Type & Promise.all Type Erasure

### Problem 1: Async functions with no explicit `return` produce LLVM errors

`function-generator.ts` has a "no return statement → void" override (~line 155) that ran AFTER the async return type was set to `%Promise*`. For `async function f(): Promise<void>` (which naturally has no `return`), this would override `%Promise*` to `void`, then the async epilogue emitted `ret %Promise*` against a `void` signature.

**Fix:** Gate the override with `!funcIsAsync`.

### Problem 2: `allocateAwaitResult` type-erases everything to `i8*`

`variable-allocator.ts:allocateAwaitResult` unconditionally stores await results as `SymbolKind.String` / `i8*`. For `await fetch(...)` this works accidentally (method-calls.ts bitcasts `i8*` to `%__FetchResponse*` on `.text()` calls). For `await Promise.all(...)` it breaks — the result is actually `%ObjectArray*`, but stored as `i8*`, causing string character indexing instead of array element indexing → segfault.

**Fix:** Inspect `(stmt.value as AwaitExpressionNode).argument` to detect `Promise.all(...)` calls and allocate as `SymbolKind.ObjectArray` / `%ObjectArray*` with proper bitcast from the `i8*` returned by `__Promise_await`.

**Pattern for future await type tracking:** For each new async API that resolves to a specific type, add a detection case to `allocateAwaitResult`. The general flow is: detect the awaited expression type → define the variable with the correct SymbolKind → bitcast the `i8*` from `__Promise_await` to the concrete type.

### Problem 3: Fetch runtime types emitted unconditionally with promises

`llvm-generator.ts` emitted `fetchCallbacks` and `fetchAsync` (which reference `%FetchWorkContext` → `%__FetchResponse`) whenever `usesPromises` was true, even if `fetch()` was never called. Similarly, `libuv.ts:generateDeclarations` emitted `%FetchWorkContext` based on promise usage, not fetch usage.

**Fix:** Gate fetch-related code generation on `usesCurl` (which tracks actual `fetch()` usage), not `usesPromises`.

### Async return type validation

Async functions now require `Promise<T>` return types. Bare `any`, `void`, `string`, etc. produce compile errors. Omitting the return type is allowed (implicit `Promise<void>`).

### Zero orphaned test fixtures

All test fixture files must have corresponding test entries. Network fixtures that need a server go in `network.test.ts` with a locally-started HTTP server (Node.js `http.createServer`). Fixtures without network dependencies go in `test-fixtures.ts`.
