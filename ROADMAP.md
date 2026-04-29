# ChadScript v2: Roadmap

## Status

145 parity tests passing. Phases 0–7 mostly complete: SWC parser, HIR pipeline, LLVM C API codegen (koffi FFI), unboxed-first with NaN-boxing escape hatch, integer narrowing, classes/interfaces/vtables, closures, generics (monomorphization), event loop (libuv), multi-file imports, and stdlib (fs, path, http, crypto, child_process, Buffer, process, console, JSON, RegExp, Map, Set, Date, os, Math, Promise.all/race/allSettled, enums, typed arrays). Dead code elimination and constant folding passes done. SWC Rust bridge (libswc_bridge.a) + DynObj C bridge + JSON→DynObj converter operational.

## What's Next

### 1. Self-Hosting Blockers (diagnosed 2026-04-28)

Attempted compiling all compiler source files. Current status per file:

| File | Status | Blocker |
|------|--------|---------|
| `src/errors.ts` | **compiles** | — |
| `src/hir/lower-state.ts` | lowering OK, codegen crash | function ref as HOF callback (`arr.map(namedFn)`) |
| `src/hir/lower.ts` | lowering error | type narrowing gap (`.value` on discriminated union typed as f64) |
| `src/hir/lower-expr.ts` | linker error | cross-module function ref (`withLine` undeclared) |
| `src/codegen/emitter.ts` | lowering error | `koffi.load()` — needs direct LLVM C bridge |
| `src/compiler.ts` | lowering error | chained method calls (`.split().pop().replace()`) |
| `src/parser.ts` | lowering error | `@swc/core.parseSync` — needs SWC C bridge |

#### A. SWC C Bridge (~200 LOC Rust + ~100 LOC C)

Replace `@swc/core` Node addon with direct C FFI. SWC Rust bridge already built (`libswc_bridge.a`). Remaining:

- [ ] Wire `cs2_swc_parse(char*)` into compiler.ts as alternative parser path
- [ ] Verify AST shape matches — 65 node types, ~60 properties used by lowering

#### B. LLVM C Bridge (~300 LOC)

Replace koffi FFI with direct LLVM-C linkage. `emitter.ts` uses ~50-80 LLVM C API functions.

- [ ] `v2-llvm-bridge.c` — thin wrappers around LLVM-C functions used by emitter
- [ ] Declare all bridge functions in emitter.ts extern table
- [ ] Link against libLLVM at compile time

#### C. Language Feature Gaps

- [ ] **Function refs as HOF callbacks** — `arr.map(namedFn)` needs closure wrapping for bare function pointers
- [ ] **Type narrowing in conditionals** — `if (x.kind === "foo") x.value` should narrow `.value` type based on discriminant
- [ ] **Chained method calls** — `a.b().c()` where callee is a nested MemberExpression
- [ ] **Cross-module function resolution** — imported functions not found at link time

#### D. Recently Fixed (2026-04-28)

- [x] `ensureI1` coercion for branch conditions (non-boolean in if/while/for/&&/||)
- [x] Builtin `Error` class registration (this.message/this.name in class methods)
- [x] Optional chaining on dynobj/boxed/i8ptr types
- [x] `Array.isArray()`, `Number.isInteger()`, `Object.hasOwn()`, `Array.from()` builtins
- [x] Dynarray HOF support (filter/map/forEach/find/findIndex/every/some)
- [x] Obj_array HOF support (C bridges + HIR dispatch)
- [x] `TsConstAssertion` (as const) unwrapping
- [x] `new Map()` without type args defaults to `Map<string, boxed>`
- [x] `for (const [, v] of map)` — null-element destructuring
- [x] `TsTypeAliasDeclaration`/`TsInterfaceDeclaration` in block scope
- [x] String method dispatch on dynobj/boxed values (startsWith, slice, etc.)
- [x] `JSON.stringify` on dynobj values

### 2. Self-Hosting Milestone

- [ ] All compiler source files pass lowering
- [ ] All compiler source files pass codegen
- [ ] **Milestone:** `./chad2 build src/compiler.ts -o chad2-native && ./chad2-native build hello.ts -o hello && ./hello`

### 3. AsyncLoweringPass — Real Async I/O (~800 LOC)

Convert async functions to state machines that yield at I/O boundaries. Currently async/await is synchronous (promise struct, typed resolve/get). Real async needs:

- [ ] State machine transform: split function at each `await` into continuation states
- [ ] Integration with libuv event loop for actual I/O yield
- [ ] Enables async `fetch`, file I/O, timers in async context

### 4. fetch API — Async Response Object

Sync `cs2_fetch_sync` already returns body as string. Upgrade to proper async Response:

- [ ] `Response` class — `.text()` returns body, `.json()` parses via yyjson, `.status` from HTTP status line, `.ok` from status
- [ ] Upgrade C bridge to return status code + body (struct or two-call API)
- [ ] `fetch(url)` returns `Promise<Response>` via AsyncLoweringPass
- [ ] Test fixture: `fetch` against local http server

### 5. DynObject + Express-Shaped API (~1-2K LOC)

Dynamic objects enable object literals with computed keys, JSON.parse returning objects, and an Express-compatible native HTTP framework.

- [x] `v2-dynobj-bridge.c` — string-keyed tagged hashmap: create, get (typed), set, has, tag, length
- [x] Object literal `{ method: "GET", url: "/" }` → `dynobj_create` + `dynobj_set` (via Record<string,T>)
- [x] Computed property access `obj["key"]` → `dynobj_get`
- [x] JSON.parse returns DynObject
- [ ] Express-shaped API on libuv http bridge: route matching, req/res objects, middleware chain
- [ ] `app.get("/users/:id", (req, res) => res.json({ id: req.params["id"] }))` compiles to native

Scope: flat string-keyed hashmap only. No prototype chains, no `for...in`, no `Object.keys()`.

### 6. Optimization Passes (~2K LOC)

- [ ] `InliningPass` — inline small functions (< N HIR nodes, single call site)
- [ ] `EscapeAnalysisPass` — stack-allocate objects that don't escape
- [ ] `UnboxWidening` — elide box/unbox pairs when boxed value only used in unboxed context
- [x] `DeadCodePass` — unreachable stmts after return/throw/break/continue
- [x] `ConstantFoldingPass` — arithmetic, string, comparison, boolean, ternary folding

### 7. npm Interop via libnode (~5-8K LOC)

Embed Node.js for packages that can't be natively compiled. Your code compiles native, npm deps run in embedded Node.

- [ ] Port v1's libnode bridge (v1 already has working V8 + libnode bridges)
- [ ] Import classifier: `import X from "express"` → check node_modules → JS runtime path
- [ ] Native ↔ JS value marshaling (NaN-boxed ↔ JS runtime values)
- [ ] **Milestone:** `npm install lodash && chad2 build app.ts -o app && ./app` works

Scope risk: native-calls-JS only (no JS→native callbacks) for v1. Skip Express-through-libnode — Phase 4's native Express covers servers.

### 8. Polish + Parity (ongoing)

- [ ] DWARF debug info — carry SWC spans through HIR, emit `!dbg` metadata
- [ ] Incremental compilation (per-module codegen caching)
- [ ] Cross-compilation support
- [ ] Generic constraints: `<T extends SomeInterface>` — vtable dispatch within monomorphized body
- [ ] Generic Map/Set/Promise (`Map<K,V>`, `Set<T>`, `Promise<T>` as generic types)

## Architecture Reference

```
TS source → SWC parseSync → HIR lowering → Transform passes → LLVM C API (koffi) → clang link → binary
```

Value strategy: **unboxed-first with NaN-boxing escape hatch.** Statically-typed values stay as raw f64/i64/i1/i8*. Dynamic types (`any`, unions) get NaN-boxed. Integer narrowing pass narrows `number` to i64 when provably integer-valued.

```
src/
  parser.ts          — SWC wrapper
  hir/
    types.ts         — HIR node definitions
    lower.ts         — SWC AST → HIR
    lower-*.ts       — specialized lowering (expr, func, class, generic, state)
  codegen/
    llvm.ts          — koffi FFI wrapper for LLVM C API
    emitter.ts       — HIR → LLVM
    emit-*.ts        — specialized emission (expr, context)
  transforms/        — dead-code, constant folding (more to come)
  compiler.ts        — orchestrator
  cli.ts             — CLI entry point
tests/fixtures/      — .ts parity tests (auto-discovered, diffed against node)
c_bridges/           — string, array, http, regex, json, crypto, fs, path, etc.
```
