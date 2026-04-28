# ChadScript v2: Roadmap

## Status

145 parity tests passing. Phases 0–7 mostly complete: SWC parser, HIR pipeline, LLVM C API codegen (koffi FFI), unboxed-first with NaN-boxing escape hatch, integer narrowing, classes/interfaces/vtables, closures, generics (monomorphization), event loop (libuv), multi-file imports, and stdlib (fs, path, http, crypto, child_process, Buffer, process, console, JSON, RegExp, Map, Set, Date, os, Math, Promise.all/race/allSettled, enums, typed arrays). Dead code elimination and constant folding passes done. SWC Rust bridge (libswc_bridge.a) + DynObj C bridge + JSON→DynObj converter operational.

## What's Next

### 1. Self-Hosting Prereqs — Language Gaps for Compiler Source

The compiler's own source uses TS features we haven't tested compiling yet. Audit + fill gaps:

- [x] **Type-alias/interface parameter resolution** — three-phase registration (pre-register names → type aliases → full interfaces), object literal → struct coercion when target is interface/class, array element type propagation for ptr types
- [x] `this.prop` for inherited class fields — parent chain traversal in field_get lookup
- [x] `import.meta.url` + `new URL()` — compile-time evaluation of `import.meta.url` → `file://` string, `new URL(str).pathname` → extract pathname
- [ ] MemberExpression callee — `module.method()` call patterns beyond destructured builtin imports (parser.ts)
- [ ] Verify: compiler source files (src/**/*.ts) compile without errors

### 2. Self-Hosting (~500 LOC new)

ChadScript compiles itself to a native binary. All stdlib prereqs are done (fs, path, child_process, Map, JSON). SWC Rust bridge built (libswc_bridge.a, 6.8MB). DynObj bridge operational with typed getters. JSON→DynObj converter done (yyjson).

- [x] `swc-bridge/src/lib.rs` — Rust static lib: `extern "C" fn swc_parse(source, len) -> json_ast`
- [x] Compile to `libswc_bridge.a`, add to build system
- [x] `c_bridges/v2-json-dynobj-bridge.c` — yyjson recursive JSON→DynObj converter
- [x] `c_bridges/v2-dynobj-bridge.c` — DynObj runtime: typed getters (get_f64/get_str/get_obj/get_bool/get_arr), setters, has/tag/length
- [x] DynObj property access in HIR lowering — target-type-aware getter selection at assignment boundary
- [ ] Alternative parser path in `compiler.ts`: native binary calls C FFI instead of `@swc/core`
- [ ] AST walker over DynObj: recursive traversal of SWC JSON AST for HIR lowering
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
