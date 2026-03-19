# ChadScript Rules

## Worktree Rule

**ALWAYS work on a git worktree and branch. NEVER modify files directly on `main`.** `main` must always remain clean. Every piece of work — features, bug fixes, docs, even CLAUDE.md edits — must happen on a dedicated branch in a worktree:

```bash
git worktree add .worktrees/<name> -b <branch-name>
cd .worktrees/<name>
# do work, commit, then open a PR
```

## Autonomous PR Workflow

Agents can work autonomously end-to-end: create worktrees, make changes, push branches, create PRs,
monitor CI, and merge when green. You have push access to feature branches and merge access to PRs.

1. Create a worktree and branch
2. Make changes, run `npm run verify:quick`, commit
3. `git push origin <branch>` — push to remote
4. `gh pr create` — open a PR
5. `gh pr checks <number>` — monitor CI
6. When CI is green: `gh pr merge <number> --squash --delete-branch` — merge to main
7. Clean up: `cd /Users/csmith/git/ChadScript && git worktree remove .worktrees/<name>`
8. Pull main and continue with next task

**Every PR must be seen through to completion** — don't just open and walk away. Monitor CI, fix failures,
merge when green, delete the remote branch, and remove the local worktree.

**Never push to main directly.** Always go through PRs.

PR descriptions should be **user-centric** — lead with how the change affects users (better error messages,
fewer crashes, new capabilities), not just technical implementation details.

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

1. `npm test` — all tests pass (auto-uses native compiler if `.build/chad` exists)
2. `bash scripts/self-hosting.sh` — full 3-stage self-hosting
3. `bash scripts/self-hosting.sh --quick` — skip Stage 2

New features have complex side effects that may not be caught by unit tests alone. A change that passes all tests can still break self-hosting. The Stage 2 test is the true verification — it proves the compiler's output is correct enough to compile itself.

## Versioning & Releases

Version is defined in one place: `package.json`. `npm run build` auto-generates `src/version.ts` via the `prebuild` script (`scripts/gen-version.js`). Both `chad-node.ts` and `chad-native.ts` import `VERSION` from there.

To bump a version:
1. Edit `version` in `package.json`
2. `npm run build` (regenerates `src/version.ts`)
3. Merge to main
4. `git tag v<version> && git push origin v<version>` — CI creates a GitHub Release with binaries

## Stale Native Compiler

After a rebase or merge that brings in new codegen features, `.build/chad` becomes stale — it was compiled
from the old source and doesn't know how to compile the new features. **Rebuild it**:

```bash
rm -f .build/chad && node dist/chad-node.js build src/chad-native.ts -o .build/chad
```

Tests auto-detect `.build/chad` and use it over `node dist/chad-node.js`. A stale native compiler causes
mysterious test failures that pass fine with the node compiler.

## Worktree Setup

Each worktree builds its own `vendor/` — do not symlink it from another worktree or the main repo. Different branches may have different `c_bridges/` sources, and a shared vendor dir causes races and silent corruption when multiple agents build concurrently.

```bash
bash scripts/build-vendor.sh
```

`npm test` rebuilds `dist/` only if `src/` is newer, and builds `.build/chad` only if missing.

# ChadScript Architecture Guide

## What It Is

TypeScript-to-native compiler using LLVM IR. Compiles .ts/.js files to native binaries via: Parser → AST → Semantic Analysis → LLVM IR Codegen → clang (compile + link) → native binary.

## Key Directories

| Dir                                       | Purpose                                                                           |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| `src/semantic/`                           | Semantic analysis passes run before codegen (closure mutation, union types)       |
| `src/codegen/`                            | LLVM IR code generation (the core)                                                |
| `src/codegen/expressions/method-calls.ts` | Central dispatcher for all `object.method()` calls                                |
| `src/codegen/types/collections/string/`   | String method IR generators (manipulation.ts, search.ts, split.ts, etc.)          |
| `src/codegen/types/collections/string.ts` | `StringGenerator` facade that delegates to sub-modules                            |
| `src/codegen/types/collections/array.ts`  | `ArrayGenerator` facade that delegates to sub-modules                             |
| `src/codegen/types/collections/array/`    | Array sub-modules (literal, mutators, search-predicate, iteration, combine, etc.) |
| `src/codegen/stdlib/`                     | Built-in module generators (console.ts, process.ts, fs.ts, math.ts, etc.)         |
| `src/codegen/infrastructure/`             | Core: generator-context.ts, symbol-table.ts, type-resolver.ts                     |
| `src/codegen/llvm-generator.ts`           | Main orchestrator, delegates to sub-generators                                    |
| `src/ast/types.ts`                        | AST node type definitions                                                         |
| `tests/compiler.test.ts`                  | Main test suite                                                                   |
| `tests/test-discovery.ts`                 | Auto-discovers test fixtures via `@test` annotations                              |
| `tests/fixtures/`                         | Test fixture programs organized by category (auto-discovered)                     |
| `c_bridges/`                              | C bridge files for complex runtime helpers (regex, json, os, etc.)                |

## How to Add a New String Method

1. **IR Generation**: Add function in `src/codegen/types/collections/string/manipulation.ts` (or search.ts, etc.)
2. **Facade**: Add `doGenerateX()` in `src/codegen/types/collections/string.ts` (StringGenerator class)
3. **Dispatch**: Add `if (method === 'x')` block in `src/codegen/expressions/method-calls.ts`
4. **Handler**: Add `private handleX()` method in method-calls.ts
5. **Test**: Add fixture in `tests/fixtures/strings/` (auto-discovered, no registry needed)

**NOTE**: Prefer direct field access (`ctx.stringGen.doMethod()`) over adding wrapper methods to `IGeneratorContext`. Concrete type propagation in `loadFieldValue` (member.ts) ensures chained access through interface fields works in the native compiler.

## How to Add a New Built-in (process.x, console.x, etc.)

1. Check if existing generator handles it (e.g., `src/codegen/stdlib/process.ts`)
2. Most built-ins are handled inline in `method-calls.ts` for performance
3. For member access (not method calls), look at `src/codegen/expressions/member.ts`
4. Test: add fixture in `tests/fixtures/builtins/` (auto-discovered, no registry needed)

## Struct Types

| LLVM Type                                | JS Type                                   |
| ---------------------------------------- | ----------------------------------------- |
| `%Array = type { double*, i32, i32 }`    | `number[]` (data ptr, length, capacity)   |
| `%StringArray = type { i8**, i32, i32 }` | `string[]`                                |
| `%ObjectArray = type { i8*, i32, i32 }`  | `object[]`                                |
| `%Uint8Array = type { i8*, i32, i32 }`   | `Uint8Array` (data ptr, length, capacity) |
| `i8*`                                    | `string` (null-terminated C string)       |
| `double`                                 | `number`                                  |
| `i1`                                     | `boolean`                                 |

## Test Patterns

Tests are auto-discovered from `tests/fixtures/` via `@test` annotations in `tests/test-discovery.ts`.
No manual registry — just add a fixture file and it's picked up automatically.

Annotation format (in the first 10 lines of each fixture file):

- `// @test-exit-code: 12` — assert process exits with code 12
- `// @test-args: hello world` — pass CLI args to the compiled binary
- `// @test-description: ...` — custom test description
- `// @test-skip` — exclude from auto-discovery

Defaults (no annotation needed):

- `expectTestPassed: true` — asserts stdout contains `TEST_PASSED` and exit code 0
- Description auto-generated from filename: `string-split-length.ts` → `string split length`

Run tests: `npm test` or `npm run test:full` (via `node scripts/test.js`)
Run tests + self-hosting: `npm run verify` (or `npm run verify:quick` to skip Stage 2)
Build: `npm run build` (TypeScript → dist/)

Tests auto-detect `.build/chad` and use it instead of `node dist/chad-node.js` (~10x faster per compile).
`compiler.test.ts` runs at concurrency 32; `smoke.test.ts` at concurrency 8.

## Useful Patterns

- `ctx.nextTemp()` — get next SSA temp variable name (%1, %2, etc.)
- `ctx.nextLabel(prefix)` — get next unique label for control flow
- `ctx.emit(line)` — emit a line of LLVM IR
- `ctx.generateExpression(expr, params)` — recursively generate an expression
- `ctx.setVariableType(name, type)` — tell the type system what type a temp is
- `createStringConstant(ctx, value)` — create a global string constant, returns i8\*
- `GC_malloc_atomic(size)` — allocate GC'd memory for non-pointer data (strings)
- `GC_malloc(size)` — allocate GC'd memory that may contain pointers

## Structured IR Builders

Prefer structured builder methods over raw `ctx.emit()` for all supported instructions:

**Memory & access:** `emitStore`, `emitLoad`, `emitGep`, `emitCall`, `emitCallVoid`, `emitBitcast`
**Comparison:** `emitIcmp`, `emitFcmp`
**Control flow:** `emitBr`, `emitBrCond`, `emitLabel`, `emitRet`, `emitRetVoid`, `emitUnreachable`
**Arithmetic:** `emitAdd`, `emitSub`, `emitMul`, `emitFAdd`, `emitFSub`, `emitFMul`, `emitFDiv`, `emitSRem`, `emitFRem`, `emitFNeg`
**Casts:** `emitZext`, `emitSext`, `emitTrunc`, `emitSitofp`, `emitFptosi`, `emitPtrtoint`, `emitInttoptr`
**Bitwise:** `emitAnd`, `emitOr`, `emitXor`, `emitShl`, `emitAShr`, `emitLShr`
**Other:** `emitPhi`, `emitSelect`, `emitAlloca`

Keep `ctx.emit()` only for: `inbounds` GEP, `!tbaa` metadata, `call void @llvm.memcpy`, and other
exotic instructions without builders.

## Terminator Classification

LLVM basic blocks must end with exactly one terminator instruction (`ret`, `br`, `unreachable`, `switch`).
Rather than parsing emitted strings to detect terminators, we use a parallel `outputIsTerminator: boolean[]`
that auto-classifies every instruction at `emit()` time. Use `ctx.lastInstructionIsTerminator()` to check.

**Single source of truth**: The classification logic lives in `terminator-classifier.ts` as a standalone
function. Both `BaseGenerator` and `MockGeneratorContext` delegate to it. To add a new terminator
(e.g., `invoke`, `indirectbr`), update `classifyTerminator()` in that one file.

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

## C Bridges

For complex runtime logic (nested loops, string manipulation, data structure building), prefer writing
C bridge functions in `c_bridges/` over raw LLVM IR string concatenation. C bridges are easier to read,
debug, and maintain.

Pattern:

1. Create `c_bridges/your-bridge.c` with `cs_` prefixed functions
2. Add build step in `scripts/build-vendor.sh` (compile to `.o`)
3. Declare extern functions in LLVM IR and call them from codegen
4. Add conditional linking in `src/compiler.ts` and `src/native-compiler-lib.ts`
5. Add to `scripts/build-target-sdk.sh` bridge list (cross-compile SDK packaging)
6. Add to `ci.yml` in all 4 places: Linux verify loop, Linux release copy, macOS verify loop, macOS release copy

Existing bridges: `regex-bridge.c`, `yyjson-bridge.c`, `os-bridge.c`, `child-process-bridge.c`,
`child-process-spawn.c`, `lws-bridge.c`, `treesitter-bridge.c`.

## Codegen Quick Rules

1. **Hoist allocas to entry block** — never in conditional branches
2. **Store pointers as `i8*`** — `double` loses 64-bit precision
3. **Check class before interface** — try `findClassImplementingInterface()` BEFORE `interfaceStructGen.hasInterface()`
4. **Load array values in objects** — load the value, don't pass the alloca
5. **Type cast field order must match FULL struct layout** — when the type extends a parent interface, the struct includes ALL parent fields. `as { name, closureInfo }` on a `LiftedFunction extends FunctionNode` (10 fields) reads index 1 instead of index 9. Include every field.
6. **`ret void` not `unreachable`** at end of void functions
7. **Class structs: boolean is `i1`; Interface structs: boolean is `double`**
8. **Propagate declared type before generating RHS for collection fields** — when a class field is typed `Set<string>`, `Map<K,V>`, etc., call `setCurrentDeclaredSetType` / `setCurrentDeclaredMapType` before `generateExpression` on the RHS so that `new Set()` / `new Map()` without explicit type args picks the right generator. See `handleClassFieldAssignment` in `assignment-generator.ts`.
9. **Set feature flags when emitting gated extern calls** — runtime declarations for C bridges (yyjson, curl, etc.) are conditionally emitted behind flags like `usesJson`, `usesCurl`. Any code path that emits `call @csyyjson_*` must call `ctx.setUsesJson(true)`, etc. Missing this causes "undefined value" errors from `clang` because the `declare` is never emitted.

## Interface Field Iteration

When building field lists for an interface (keys/types arrays for ObjectMetadata), always use
`getAllInterfaceFields(interfaceDef)` instead of `interfaceDef.fields`. The latter only returns the
interface's OWN fields, missing inherited fields from `extends`. This causes wrong GEP indices for
any interface with inheritance. All current allocation methods (`allocateDeclaredInterface`,
`allocateMemberAccessInterface`, `allocateFunctionInterfaceReturn`, etc.) use `getAllInterfaceFields`
correctly — maintain this when adding new ones.

## Loop Style

Prefer `for...of` over index-based `for` loops when iterating arrays — it's fully supported and more idiomatic:

```typescript
for (const item of items) { ... }         // good
for (let i = 0; i < items.length; i++) {} // only when index is needed
```

## Code Style

- Prettier auto-formats code; run `npm run format` to fix, `npm run format:check` to verify
- One-line comments are helpful on dense codegen blocks — explain the "why" or the LLVM IR pattern, not the "what"
- Use named AST types from `src/ast/types.ts` for type assertions instead of inline `as { ... }` structs
- There are several MASSIVE files. Where possible, do not add to them. Make a new file, and leave a comment in the other file to not touch it anymore, and to progressively break it down into smaller files.

## Patterns That Crash Native Code

1. **`new` in class field initializers** — codegen handles simple `new X()` in field initializers (both explicit and default constructors), but complex nested class instantiation may have edge cases. Prefer initializing in constructors for safety.
2. **Type assertions must match real struct field order AND count** — `as { type, left, right }` on a struct that's `{ type, op, left, right }` causes GEP to read wrong fields. Fields must be a PREFIX of the real struct in EXACT order. **Watch out for `extends`**: if `Child extends Parent`, the struct has ALL of Parent's fields first, then Child's. A type assertion on a Child must include Parent's fields too — even optional ones the object literal doesn't set (the compiler allocates slots for them anyway, filled with null/0).
3. **Never insert new optional fields in the MIDDLE of an interface** — The native compiler determines struct layouts from object literal creation sites. If an interface has multiple creation sites (e.g., `MethodCallNode` is created in parser-ts, parser-native, and codegen), inserting a new field before existing ones shifts GEP indices and breaks creation sites that don't include the new field. **Always add new optional fields at the END of interfaces.** Root cause: the native compiler doesn't unify struct layouts from interface definitions — it uses object literal field order, and different creation sites may have different subsets of fields.
4. **`alloca` for collection structs stored in class fields** — `%Set`, `%StringSet`, `%Map`, and similar structs must be heap-allocated via `GC_malloc`, not `alloca`. Stack-allocated structs become dangling pointers when stored in a class field after the constructor returns. Use `emitCall("i8*", "@GC_malloc", "i64 N") + emitBitcast(...)` instead of `emit("... = alloca %Foo")`.
5. **Never invent a subset/partial type for a type assertion** — always use the real AST type from `src/ast/types.ts`. An invented `type FunctionMeta = { name, returnType, parameters }` silently generates wrong GEP indices when its field order doesn't match the actual struct. The `object-method.js` SIGSEGV was caused by exactly this: `FunctionMeta.parameters` sat at index 2, but `FunctionNode.parameters` is at index 6, so every access read the wrong field. The real type always works — TypeScript's structural typing lets you access any subset of fields safely without redefining a partial interface.
6. **`||` fallback makes member access opaque** — `const x = foo.bar || { field: [] }` stores the result as `i8*` (opaque pointer) because the `||` merges two different types. Subsequent `.field` access on `x` does NOT generate a GEP — it just returns `x` itself. Fix: use a ternary that preserves the typed path: `const y = foo.bar ? foo.bar.field : []`. This applies to any `||` or `??` where the fallback is an inline object literal.

## Stage 0 Compatibility

Self-hosting limitations:

- **No import aliases** — `import { foo as bar }` compiles `bar(...)` as `@_cs_bar` which doesn't match the original `@_cs_foo`. Use the original name.
- **No union type parameters in standalone functions** — `fn(x: Expression)` where `Expression` is a union emits the TS type name literally. Keep union-typed parameters in class methods.

## Module System

ChadScript merges all imported files into one flat AST. `export default` maps the local import name to the exported name via `importAliases` (resolved in `resolveImportAlias()`). Re-exports synthesize `ImportDeclaration` entries — semantically equivalent to imports.

## Enums — Not Supported

Enum declarations emit a compile error with a suggestion to use `as const` objects instead. The semantic
pass `enum-checker.ts` rejects all enums before codegen. The compiler's own internal "enums" (SymbolKind,
VarKind, LogLevel) were converted to plain `const` number values (e.g., `const SymbolKind_Number = 0`).

## Optional Method Calls (`?.()`)

`MethodCallNode.optional` (must be at END of interface — see rule #3 above) triggers null-check branching in `generateOptionalMethodCall` in `method-calls.ts`. Pattern: evaluate object → icmp null → branch → phi merge, similar to `generateOptionalChain` for property access.

## Async/Await Type Tracking

`allocateAwaitResult` in `variable-allocator.ts` must inspect the awaited expression to determine the correct SymbolKind. Default is `i8*`/string, but `Promise.all()` resolves to `%ObjectArray*`. For each new async API that resolves to a specific type, add a detection case to `allocateAwaitResult`.

## Semantic Analysis Passes

Semantic passes live in `src/semantic/` and run before codegen (called from `LLVMGenerator.generateParts()`).
They catch errors that would produce silently wrong native code — the native compiler can't throw exceptions
at runtime, so these must be compile-time errors.

Current passes:

- **`closure-mutation-checker.ts`** — ChadScript closures capture by value. Mutating a variable after capture
  produces silently wrong results. This pass detects post-capture assignments and emits a compile error.
- **`union-type-checker.ts`** — Type alias unions like `type Mixed = string | number` bypass the inline union
  check. This pass resolves aliases and rejects unions whose members map to different LLVM representations.

To add a new semantic pass: create `src/semantic/your-check.ts`, export a `checkX(ast: AST): void` function,
and call it from `generateParts()` in `llvm-generator.ts`.

## LLVMGenerator.reset()

New per-function state goes in `BaseGenerator.reset()` if it's a base field, or after `super.reset()` in the override for LLVMGenerator-only fields.

## Expression Orchestrator — No Silent Nulls

`orchestrator.ts` must **never** silently generate null pointers (`inttoptr i64 0 to i8*`) for unrecognized
expressions. These nulls are UB that LLVM `-O2` can exploit to prune unrelated code paths. Both fallback
paths (empty type, unsupported type) now call `ctx.emitError()` which is `never`-typed — it exits the
compiler immediately. If a new expression type is added to the parser, add a handler in the orchestrator;
don't rely on a fallback.
