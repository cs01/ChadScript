# ChadScript v2: Roadmap

## Status

160 parity tests passing (50 fixture files). SWC parser, HIR pipeline, LLVM C API codegen (koffi FFI), unboxed/NaN-boxing, integer narrowing, classes/interfaces/vtables, closures, generics, event loop (libuv), multi-file imports, stdlib, dead code elimination, constant folding, SWC Rust bridge, DynObj bridge, JSON→DynObj all operational.

## Known Bugs

- **Mixed-type tuple lowering**: `[a: string, b: string, c: string[]][]` collapses to `array<BOXED>` per `lower-state.ts:228` (TsTupleType). Each tuple element gets NaN-boxed when stored, including nested arrays. Workaround applied in declareExterns (avoid tuples). Real fix: support proper tuple types in HIR.
- **Stage1 silent emitModule exit at O2**: distinct from the now-fixed verifier crash. `[compile] emitModule start` prints, then exit 0 with no binary. Needs trace through emitObjectFile's runPasses → emit_to_file path in stage1 native.

## Perf Hotspots (vs perry)

- **string_concat 0.38s vs 0.00s**: `result = result + "x"` × 100k is O(n²) — every concat does `strlen+strlen+malloc+strcpy+strcat`. Fix path: detect `var = var + expr` / `var += str` pattern in lowering, emit `cs_string_append_inplace` (realloc + memcpy) for amortized O(n).
- **closure 22x slower**: `compute(i)` in tight loop. IR shows `sitofp i64→f64`, `call compute(double)`, `fptosi double→i64` per iter. Conversions kill perf. Fix path: integer-narrowing pass should infer compute's return type from body when params are integer-narrowed.
- **matrix_multiply 4x**: each `arr[i]` calls `cs2_num_array_get` with bounds check, kills auto-vectorize. Fix path: emit direct GEP for `array<f64>` index access in tight contexts.

## 1. Self-Hosting (active blocker)

Stage1 pipeline (2026-05-01):
- Parse SWC AST: ✓
- Lower (resolve modules + lower-module-item): ✓
- Emit IR (through finalizeDebugInfo): ✓
- LLVM O2 passes: ✗ — segfault in `addArgumentAttrs` (arg names)
- IR print: ✗ — module itself malformed

Likely root: stage1 generates function decls with bad name strings or arg attributes. ~3-5 layered fixes remain.

### A. SWC C Bridge (~200 LOC Rust + ~100 LOC C)

Replace `@swc/core` Node addon with direct C FFI. `libswc_bridge.a` built. Remaining:
- [ ] Wire `cs2_swc_parse(char*)` into compiler.ts
- [ ] Verify AST shape matches (65 node types, ~60 properties)

### B. LLVM C Bridge (~300 LOC)

Replace koffi FFI with direct LLVM-C linkage (~50-80 functions).
- [ ] `v2-llvm-bridge.c` wrappers
- [ ] Declare bridge functions in emitter.ts extern table
- [ ] Link against libLLVM at compile time

### C. Language Feature Gaps (remaining)

- [ ] Chained method calls — `a.b().c()` nested MemberExpression
- [ ] Cross-module function resolution — imported functions not found at link time

### Milestone

`./chad2 build src/compiler.ts -o chad2-native && ./chad2-native build hello.ts -o hello && ./hello`

## 2. AsyncLoweringPass (~800 LOC)

State machine transform at `await` boundaries + libuv integration. Currently async/await is synchronous.

## 3. fetch API — Async Response

Upgrade sync `cs2_fetch_sync` to `Promise<Response>` with `.text()`, `.json()`, `.status`, `.ok`.

## 4. Express-Shaped API

DynObj infra done. Remaining: route matching, req/res objects, middleware chain on libuv http bridge.

## 5. Optimization Passes

- [ ] InliningPass — small functions, single call site
- [ ] EscapeAnalysisPass — stack-allocate non-escaping objects
- [ ] UnboxWidening — elide box/unbox pairs

## 6. npm Interop via JS Compilation (~2-3K LOC)

Compile `.js` as all-`any`/dynobj. No V8. Same binary, zero marshaling. Typed TS = fast unboxed, untyped JS = slower dynobj dispatch.

- [ ] `.js` parsing, all-`any` inference
- [ ] `Object.keys()`, `for...in`, `delete`, prototype chains
- [ ] `node_modules` resolution
- [ ] **Milestone:** `npm install lodash && chad2 build app.ts -o app`

Won't support: `eval()`, `with`, `arguments`, dynamic `require()`.

## 7. Polish (ongoing)

- [ ] DWARF debug info
- [ ] Incremental compilation
- [ ] Cross-compilation
- [ ] Generic constraints (`<T extends I>`)
- [ ] Generic Map/Set/Promise
