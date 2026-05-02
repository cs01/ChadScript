# ChadScript v2: Roadmap

## Status

160 parity tests passing (50 fixture files). SWC parser, HIR pipeline, LLVM C API codegen (koffi FFI), unboxed/NaN-boxing, integer narrowing, classes/interfaces/vtables, closures, generics, event loop (libuv), multi-file imports, stdlib, dead code elimination, constant folding, SWC Rust bridge, DynObj bridge, JSON→DynObj all operational.

## Known Bugs (need fix)

- **Float literal narrowing**: `let x = 1.0` narrows to i64 (Number.isInteger(1.0) === true). All float math then truncates. Affects mandelbrot, math_intensive, loop_data_dependent. Fix: use `lit.raw.includes(".")` or check declared type before narrowing in `lowerNumericLiteral`.
- **Array index-assign doesn't grow**: `arr[i] = v` on empty `number[]` silently no-ops. Only `push()` grows. Affects sieve, array_write/read, nested_loops. Fix: `cs2_num_array_set` (and obj/str variants) should auto-grow when `index >= length`.

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
