# ChadScript v2: Rewrite Roadmap

## Context

ChadScript's AST-direct-to-LLVM architecture hit a scaling wall: 67K lines of string-concatenated IR generation, 133KB monolith files, 21 semantic passes papering over missing abstractions. The core type strategy (unboxed by default) is proven — 3.5x faster than box-first compilers on numeric workloads — but the architecture can't support full Node compat or sustainable feature velocity.

This rewrite keeps what works (unboxed perf, test fixtures, C bridges, semantic passes) and replaces what doesn't (codegen layer) with a proper HIR-based pipeline. The key innovation: **unboxed-first with NaN-boxing escape hatch** — a strategy no other TS-to-native compiler uses.

## Architecture

```
TS source
  → SWC parseSync (@swc/core)
  → SWC AST (fully typed, type annotations preserved)
  → Lowering (type resolution, scope building, name resolution)
  → HIR (typed, resolved, unambiguous)
  → Transform passes (closure conversion, async lowering, box/unbox insertion)
  → Optimized HIR
  → LLVM IR emission via LLVM C API (not text strings — type-safe, catches errors at build time)
  → LLVM optimize + emit object → link → binary
```

## Value Representation: Hybrid Unboxed/Boxed

**The differentiator.** Box-first compilers NaN-box everything. ChadScript v1 unboxes everything (raw types). v2 does both:

```
Unboxed (default when type is statically known):
  number    → f64 (raw IEEE 754 double)
  number    → i32 (when provably integer — see Integer Narrowing below)
  boolean   → i1
  string    → i8* (null-terminated)
  number[]  → %Array { f64*, i32, i32 }
  string[]  → %StringArray { i8**, i32, i32 }
  MyClass   → %MyClass* (struct pointer)

NaN-boxed (escape hatch for dynamic/unknown types):
  any       → f64 (NaN-tagged)
  unknown   → f64 (NaN-tagged)
  T | U     → f64 (NaN-tagged, when T and U have different LLVM repr)
  untyped   → f64 (NaN-tagged)

NaN-box layout (standard encoding):
  raw f64          = number (doubles pass through untouched)
  0x7FFC_..._0001  = undefined
  0x7FFC_..._0002  = null
  0x7FFC_..._0003  = false
  0x7FFC_..._0004  = true
  0x7FFD + 48-bit  = pointer (object/array/closure)
  0x7FFF + 48-bit  = string pointer
  0x7FFE + 32-bit  = i32

Box/unbox boundaries:
  Unboxed → boxed:  insert `box` HIR node (tag the value)
  Boxed → unboxed:  insert `unbox` HIR node (check tag + extract)
  Decision made by: BoxInsertionPass on HIR, using type info from lowering

Narrow/widen boundaries:
  f64 → i32:  insert `narrow_i32` HIR node (fptosi)
  i32 → f64:  insert `widen_f64` HIR node (sitofp)
  Decision made by: IntegerNarrowingPass on HIR
```

### Integer Narrowing (The Secret Sauce)

This is the deepest performance advantage — beyond just "unboxed doubles." When a `number` is provably integer-valued, we narrow it to `i32` and keep it there through entire computation chains.

**What a box-first compiler does for `i % 2`:**

```llvm
; box-first: number is always f64 (NaN-boxed), must round-trip through int
%1 = call double @unbox(%arg0)     ; untag NaN-box
%2 = fptosi double %1, i32         ; double → int
%3 = srem i32 %2, 2               ; actual modulo
%4 = sitofp i32 %3, double         ; int → double
%5 = call double @box(%4)          ; re-tag as NaN-box
; 5 instructions, 2 type conversions, 2 box operations
```

**What ChadScript v2 does for `i % 2` (when `i` is narrowed to i32):**

```llvm
%3 = srem i32 %i, 2
; 1 instruction. Done.
```

**When to narrow:**

- Loop counter variables: `for (let i = 0; i < n; i++)` → `i` is i32
- Integer literal assignments: `const x = 42` → x is i32
- Bitwise operations: `x & 0xFF`, `x << 2`, `x | mask` → result is i32
- Array indices: `arr[i]` → index is i32
- Integer arithmetic chains: `i + 1`, `i * j`, `i % 2` when both operands are i32 → result is i32
- Function params when all call sites pass i32 (interprocedural narrowing)

**When to widen back to f64:**

- Division that might produce a fraction: `i / 3` → widen to f64 before `fdiv`
- Passed to a function expecting f64
- Stored in a `number[]` (f64 array)
- Compared with a float: `i === 3.14`
- Overflow risk: `i32` wraps at 2^31; if the value could exceed that, stay f64

**Implementation — `IntegerNarrowingPass` (HIR transform):**

1. Walk all `let` declarations. If init is integer literal or `0`, mark as i32 candidate.
2. Walk all assignments to that variable. If all are integer-producing ops (add, sub, mul, srem, bitwise), confirm i32.
3. Walk all uses. If any use requires f64 (passed to f64 function, stored in f64 array, division), insert `widen_f64` at that use site only.
4. For function params: if all call sites pass i32 values, generate i32 ABI for that param.
5. Codegen: i32 locals get `alloca i32` instead of `alloca double`. All arithmetic stays in i32.

**Interprocedural narrowing (the real win for benchmarks):**

```typescript
function monteCarlo(iterations: number): number {
  let inside = 0; // ← narrowed to i32
  for (let i = 0; i < iterations; i++) {
    // ← i narrowed to i32
    const x = Math.random() * 2 - 1; // ← stays f64 (random returns f64)
    const y = Math.random() * 2 - 1;
    if (x * x + y * y <= 1) inside++; // ← i32 add, no f64 conversion
  }
  return inside; // ← i32 → f64 widen only at return
}
```

The entire inner loop runs with `inside` as native i32. A box-first compiler would have `inside` as NaN-boxed f64, requiring `fptosi → add → sitofp → box` for every `inside++`. That's the 3.5x gap.

**Why this wins:** In `fib(n: number): number`, the entire call chain stays as raw `f64 → f64` (or `i32 → i32` when narrowed). No tagging, no untagging, no type checks, no int↔float conversions. Box-first compilers must tag/untag at every function boundary AND convert between f64 and integer for every integer op. ChadScript's unbox-first + integer narrowing strategy is structural — retrofitting it onto a box-first architecture requires dual ABI for every function AND integer narrowing analysis, which is a major rearchitecture.

## What Survives From v1

| Component                              | Lines  | Action             | Rationale                                                                    |
| -------------------------------------- | ------ | ------------------ | ---------------------------------------------------------------------------- |
| Test fixtures (718 files)              | —      | **REFERENCE ONLY** | Many use ChadScript imports/semantics; write new Node-compat fixtures for v2 |
| Test discovery + harness               | ~180   | **KEEP pattern**   | Annotation-based discovery is good; adapt for v2 fixture dirs                |
| C bridges (regex, json, net, pg, etc.) | 8,682  | **KEEP 90%**       | Runtime helpers, not tied to codegen                                         |
| Semantic passes (21 passes)            | 6,335  | **KEEP 90%**       | Operate on AST, not IR                                                       |
| Diagnostic engine                      | 604    | **KEEP**           | Pure error reporting                                                         |
| AST types (types.ts)                   | 537    | **KEEP or evolve** | May adapt to SWC AST                                                         |
| Build tooling (scripts/)               | 2,722  | **KEEP 95%**       | Backend-agnostic                                                             |
| CI pipeline                            | 877    | **KEEP**           | Update invocations only                                                      |
| lib/ stdlib stubs                      | 3,123  | **KEEP**           | API specs                                                                    |
| Codegen (67K lines)                    | 67,665 | **DISCARD**        | This is the rewrite                                                          |

~32K lines survive. ~67K lines replaced with ~15-20K lines of HIR + new codegen.

## HIR Design

The HIR is the core new abstraction. It's a typed, lowered, unambiguous IR — all names resolved, all types concrete, all sugar desugared.

```typescript
// hir/types.ts — the whole thing should be ~500-800 lines

type HIRType =
  | { kind: "f64" } // number (floating point)
  | { kind: "i32" } // number (narrowed integer — the secret sauce)
  | { kind: "i1" } // boolean
  | { kind: "i8ptr" } // string
  | { kind: "void" }
  | { kind: "ptr"; pointee: string } // class/interface struct
  | { kind: "array"; element: HIRType }
  | { kind: "boxed" } // NaN-boxed value (f64 with tag)
  | { kind: "struct"; name: string; fields: HIRField[] };

type HIRExpr =
  | { kind: "literal_f64"; value: number }
  | { kind: "literal_i1"; value: boolean }
  | { kind: "literal_string"; value: string }
  | { kind: "literal_null" }
  | { kind: "local_get"; id: number; type: HIRType }
  | { kind: "local_set"; id: number; value: HIRExpr }
  | { kind: "global_get"; name: string; type: HIRType }
  | { kind: "global_set"; name: string; value: HIRExpr }
  | { kind: "binary"; op: BinaryOp; left: HIRExpr; right: HIRExpr; type: HIRType }
  | { kind: "unary"; op: UnaryOp; operand: HIRExpr; type: HIRType }
  | { kind: "call"; callee: string; args: HIRExpr[]; returnType: HIRType }
  | { kind: "call_indirect"; callee: HIRExpr; args: HIRExpr[]; returnType: HIRType }
  | { kind: "field_get"; object: HIRExpr; index: number; type: HIRType }
  | { kind: "field_set"; object: HIRExpr; index: number; value: HIRExpr }
  | { kind: "index_get"; array: HIRExpr; index: HIRExpr; type: HIRType }
  | { kind: "index_set"; array: HIRExpr; index: HIRExpr; value: HIRExpr }
  | { kind: "box"; value: HIRExpr; fromType: HIRType } // unboxed → NaN-box
  | { kind: "unbox"; value: HIRExpr; toType: HIRType } // NaN-box → unboxed
  | { kind: "narrow_i32"; value: HIRExpr } // f64 → i32 (fptosi)
  | { kind: "widen_f64"; value: HIRExpr } // i32 → f64 (sitofp)
  | { kind: "alloc_struct"; structName: string; fields: HIRExpr[] }
  | { kind: "alloc_array"; elementType: HIRType; initialValues: HIRExpr[] }
  | { kind: "runtime_call"; func: string; args: HIRExpr[]; returnType: HIRType }
  | { kind: "phi"; branches: { label: string; value: HIRExpr }[]; type: HIRType };
// ... ~30-40 total node kinds. Built-in methods use runtime_call, not dedicated variants.

type HIRStmt =
  | { kind: "let"; id: number; name: string; type: HIRType; init?: HIRExpr; mutable: boolean }
  | { kind: "expr"; expr: HIRExpr }
  | { kind: "return"; value?: HIRExpr }
  | { kind: "if"; condition: HIRExpr; then: HIRStmt[]; else?: HIRStmt[] }
  | { kind: "while"; condition: HIRExpr; body: HIRStmt[] }
  | { kind: "for"; init?: HIRStmt; condition?: HIRExpr; update?: HIRExpr; body: HIRStmt[] }
  | { kind: "break" }
  | { kind: "continue" }
  | { kind: "switch"; discriminant: HIRExpr; cases: HIRSwitchCase[] }
  | { kind: "throw"; value: HIRExpr }
  | { kind: "try"; body: HIRStmt[]; catch?: HIRCatch; finally?: HIRStmt[] };

interface HIRFunction {
  name: string;
  params: { id: number; name: string; type: HIRType }[];
  returnType: HIRType;
  body: HIRStmt[];
  isAsync: boolean;
  captures: number[]; // closure captures by local id
}

interface HIRModule {
  functions: HIRFunction[];
  classes: HIRClass[];
  globals: HIRGlobal[];
  init: HIRStmt[]; // module-level initialization
}
```

Key design principles:

- **Every node carries its type.** Codegen never needs to infer anything.
- **`box`/`unbox` are explicit nodes.** The transform pass inserts them; codegen just emits them mechanically.
- **~30-40 expression kinds, lean by design.** We use `runtime_call` for built-in methods (`array.push`, `string.split`, etc.) — the HIR doesn't need a variant per built-in function.
- **No sugar.** `for...of` is lowered to `for` + index. `?.` is lowered to `if` + null check. Destructuring is lowered to field access. The HIR only has primitive control flow.

## Parser: SWC (@swc/core)

Replace both current parsers (TS API + tree-sitter) with SWC.

- `parseSync(code, { syntax: "typescript" })` — sub-2ms for typical files
- Full type annotations preserved: `: number`, `: string[]`, `Map<K,V>`, generics, unions — all in the AST
- Well-typed nodes with `@swc/types`
- JSON-serializable (no opaque handles)
- No type checking (we do our own) — exactly what we want

```typescript
import { parseSync } from "@swc/core";
const ast = parseSync(source, { syntax: "typescript", decorators: true });
// ast.body is ModuleItem[] with full type annotations
```

## Implementation Phases

### Phase 0: Scaffold (~1-2 weeks, ~2K LOC)

**Goal:** New repo, SWC parsing, LLVM C API bridge, empty HIR pipeline end-to-end.

- [x] Close all 9 open v1 issues with "superseded by v2 rewrite" comment
- [x] Create `v2` branch from main, gut v1 codegen/tests, keep C bridges + build tooling
- [x] Rewrite CI config: just build + test for v2, no self-hosting, no native compiler bootstrap
- [x] `npm install @swc/core`
- [x] Update CI: trigger on `v2` branch, strip self-hosting/benchmark/native-compiler jobs
- [x] `src/parser.ts` — SWC wrapper, returns ChadScript AST
- [x] `src/hir/types.ts` — HIR node type definitions
- [x] `src/hir/lower.ts` — stub lowering (ChadScript AST → HIR), handles `console.log("hello")`
- [x] `src/codegen/llvm-bridge.c` — C bridge wrapping LLVM C API — **replaced with koffi FFI to libLLVM.dylib**
- [x] `src/codegen/emitter.ts` — HIR → LLVM via C bridge (not text strings)
- [x] `src/compiler.ts` — orchestrator: parse → lower → emit → link
- [x] **Milestone:** `chad2 build hello.ts -o hello && ./hello` prints "hello world"

### Phase 1: Numeric Core (~2-3 weeks, ~4-5K LOC)

**Goal:** All numeric operations work unboxed with integer narrowing. Fibonacci, monte carlo, prime sieve pass.

- [x] Lowering: functions, let/const, if/else, while, for, return
- [x] Lowering: number literals, arithmetic (+, -, \*, /, %), comparisons
- [x] Lowering: function calls with typed params (f64/i64 ABI) — **changed to i64 for overflow safety**
- [x] Lowering: boolean operations, logical &&/||
- [x] Integer narrowing: i64 for integer values, bitwise ops enforce JS ToInt32 (trunc→i32 op→sext i64)
- [x] Codegen: function declarations with unboxed signatures (f64 or i64 per param)
- [x] Codegen: basic blocks, branches, phi nodes
- [x] Codegen: i64 locals get `alloca i64`, f64 locals get `alloca double`
- [x] Codegen: `narrow_i64` → `fptosi`, `widen_f64` → `sitofp`
- [x] **Milestone:** fib(40), monte carlo, prime sieve all pass — 36 parity tests passing
- [x] Run existing test fixtures: all 36 parity tests pass

### Phase 1.5: LLVM C API Swap (~1 week, ~1-2K LOC)

**Goal:** Replace text `.ll` emission with LLVM C API calls. Do this before Phase 2 so all subsequent codegen uses the type-safe API.

- [x] `src/codegen/llvm.ts` — koffi FFI wrapper for LLVM C API (replaces C bridge approach)
- [x] TypeScript bindings via koffi — direct FFI to libLLVM.dylib, no N-API addon needed
- [x] `emitter.ts` calls LLVM C API directly via koffi, no string concatenation
- [x] LLVM C API emits object file directly via `LLVMTargetMachineEmitToFile`
- [x] Keep clang for linking only (object → binary)
- [x] Verify: all 36 tests pass with identical output
- [x] **Milestone:** Zero string-concatenated IR. All LLVM emission goes through typed C API calls.

**Why now:** text IR is fine for bootstrapping, but every new Phase 2+ emitter written against text will need rewriting. Swap once now, write all future codegen against the real API.

### Phase 2: Strings + Arrays (~2 weeks, ~4-5K LOC)

**Goal:** String and array operations, still all unboxed (statically typed).

- [x] Lowering: string literals, concatenation, string methods
- [x] Lowering: typed arrays (`number[]`, `string[]`), push/pop/length/index
- [ ] Lowering: `Uint8Array`, `Float64Array`
- [x] Codegen: array struct layout via C bridges (`v2-array-bridge.c`: NumArray/StrArray { ptr, len, cap })
- [x] Codegen: string as `i8*`, malloc for allocation
- [x] Codegen: `runtime_call` for string/array ops → v2-string-bridge.c, v2-array-bridge.c
- [ ] Wire up regex bridge
- [x] **Milestone:** string + array parity tests passing (36 total)

### Phase 3: Classes + Interfaces (~2-3 weeks, ~4-5K LOC)

**Goal:** Object system with struct layout, vtable dispatch.

- [x] Lowering: class declarations, fields, methods, constructors
- [x] Lowering: `this`, method calls, property access
- [x] Lowering: inheritance (extends)
- [x] Codegen: struct layout for classes (GC_malloc + GEP field access)
- [x] Codegen: `alloc_struct` → `GC_malloc` + field init
- [x] Codegen: class arrays via ObjArray (void\*\* storage)
- [x] DWARF debug info — lldb line-level stepping in .ts source files
- [x] Lowering: interface declarations, structural typing
- [x] Lowering: interface implementation (class implements interface)
- [x] Codegen: vtable for method dispatch (fat pointer: {data, vtable})
- [x] Number formatting: shortest-representation matching Node output
- [x] **Milestone:** 47 parity tests passing including interfaces

### Phase 4: Closures + Async (~2-3 weeks, ~4K LOC)

**Goal:** Closures capture correctly, async/await works.

- [x] Closure capture analysis in lowering (outerLocals, capturedIds tracking)
- [x] Nested FunctionDeclaration support (lowerNestedFunctionDecl)
- [x] Function type annotation parsing (TsFunctionType → closure HIR type)
- [x] make_closure / call_closure HIR nodes
- [x] Env struct allocation in outer functions (malloc, captured local promotion)
- [x] Captured variable access through env GEP (load/store)
- [x] Closure struct representation: { i8* fn_ptr, i8* env_ptr }
- [x] Mutable captures (shared heap env between outer and inner)
- [x] Immutable captures (value copied into env)
- [x] Codegen: closure struct allocation, indirect calls through function pointer
- [x] **Milestone:** `tests/fixtures/closures.ts` passing — 48 parity tests
- [x] Arrow function closures (captures in arrow expressions)
- [x] Higher-order functions (pass closures as args, call them) — 50 tests
- [ ] `AsyncLoweringPass`: HIR transform
  - Convert async functions to state machines
  - `await` → yield point in state machine
  - Wire up promise resolution
- [ ] Codegen: async state machine, promise integration
- [ ] **Milestone:** `tests/fixtures/async/` passing

### Phase 5: Language Gaps (~1-2 weeks, ~2-3K LOC)

**Goal:** Round out the language before stdlib. Fill in common TS features that don't need NaN-boxing.

- [x] try/catch/throw — setjmp/longjmp based exception handling
- [ ] Array destructuring — `const [a, b, c] = arr`
- [ ] Object destructuring — `const { x, y } = obj`
- [ ] Spread in arrays — `[...arr, 1, 2]`
- [ ] Rest parameters — `function foo(...args: number[])`
- [ ] Default parameters — `function foo(x: number = 10)`
- [ ] Optional chaining — `obj?.prop` (desugar to null check)
- [ ] Nullish coalescing — `a ?? b`
- [ ] **Milestone:** Common TS patterns compile and run correctly

### Phase 6: NaN-Boxing Escape Hatch (~2 weeks, ~3-4K LOC)

**Goal:** Dynamic types work. `any`, unions, untyped params all NaN-boxed.

- [ ] `BoxInsertionPass`: HIR transform that finds box/unbox boundaries
  - Function param is `any` or untyped → box at call site
  - Value assigned to `any`-typed variable → box
  - Value read from `any`-typed variable → unbox before use
  - Union types where members have different LLVM repr → box
- [ ] Codegen: `box` node → NaN-tag the value (tag depends on source type)
- [ ] Codegen: `unbox` node → check tag + extract raw value
- [ ] Runtime: NaN-box helpers (tag/untag/typecheck) as C bridge or inline
- [ ] Dynamic dispatch: `js_dynamic_add`, `js_dynamic_less`, etc. for boxed values
- [ ] **Milestone:** Programs mixing typed and untyped code work correctly

### Phase 7: Stdlib + Node Compat (~4-6 weeks, ~8-10K LOC)

**Goal:** Full Node.js API surface. Start with 15-20 core modules (80/20), then expand to long tail. Each new module is just more `runtime_call` targets backed by C bridges — incremental, not architectural.

- [ ] `console` (log, error, warn, time, timeEnd)
- [ ] `fs` (readFileSync, writeFileSync, existsSync, readdirSync, async variants)
- [ ] `path` (join, resolve, dirname, basename, extname)
- [ ] `process` (argv, env, exit, cwd, stdin/stdout/stderr)
- [ ] `JSON` (parse, stringify) — reuse yyjson bridge
- [ ] `http` / `fetch` — reuse lws bridge
- [ ] `child_process` (exec, spawn) — reuse existing bridges
- [ ] `crypto` (randomBytes, createHash) — reuse existing bridge
- [ ] `Buffer` — reuse existing bridge
- [ ] `RegExp` — reuse PCRE2 bridge
- [ ] `Map`, `Set` (native implementations)
- [ ] `Promise.all`, `Promise.race`, `Promise.allSettled`
- [ ] `setTimeout`, `setInterval` (via libuv)
- [ ] **Milestone:** Real-world programs compile and run. Express-like server works.

### Phase 8: Self-Hosting (~2-3 weeks, ~500 LOC new)

**Goal:** ChadScript compiles itself to a native binary.

Feasible here because Phase 6 gives us the Node APIs the compiler uses (fs, path, child_process, Map, JSON). The only blocker is the parser: SWC is a Rust native addon — a ChadScript binary can't `require("@swc/core")`. Solution: **Rust FFI bridge to `swc_ecma_parser`**.

- [ ] `swc-bridge/src/lib.rs` — ~50-100 lines of Rust: `extern "C" fn swc_parse(source, len) -> json_ast` using `swc_ecma_parser`, serializes AST to JSON via serde
- [ ] Compile to `libswc_bridge.a` (static library), add to build system
- [ ] `c_bridges/swc-json-bridge.c` — thin C wrapper that ChadScript calls, passes JSON to yyjson for parsing
- [ ] Alternative parser path in `compiler.ts`: when running as native binary, call C FFI instead of `@swc/core`
- [ ] Verify: the compiler's own source (~2-3K lines) compiles and produces identical output
- [ ] **Milestone:** `./chad2 build src/compiler.ts -o chad2-native && ./chad2-native build hello.ts -o hello && ./hello` prints "hello world"

**Not a tax this time:** self-hosting is a victory lap, not a design constraint. We don't require every feature to bootstrap — just enough TS support to compile the compiler source. No "two compiler" tax.

### Phase 9: Optimization Passes (~2-3 weeks, ~3K LOC)

**Goal:** Match or beat v1 benchmarks across all workloads.

- [ ] `InliningPass`: inline small functions (< N HIR nodes, single call site)
- [ ] `EscapeAnalysisPass`: stack-allocate objects that don't escape
- [ ] `DeadCodePass`: remove unreachable blocks
- [ ] `ConstantFoldingPass`: evaluate constant expressions at compile time
- [ ] `UnboxWidening`: when a boxed value is only used in unboxed context, elide the box/unbox pair
- [ ] **Milestone:** All benchmarks match or beat v1 numbers

### Phase 10: Polish + Parity (~ongoing)

- [ ] DWARF debug info — carry SWC spans through HIR, emit `!dbg` metadata on LLVM instructions. Just `DIFile`/`DISubprogram`/`DILocation` metadata — LLVM handles the rest. Gives `lldb` line-level stepping and backtraces with `.ts` filenames for free.
- [ ] Incremental compilation (per-module codegen caching)
- [ ] Cross-compilation support
- [ ] Parity testing (byte-for-byte output comparison against `node`)

## Key Files (New)

```
src/v2/
  parser.ts              — SWC wrapper (~50 lines)
  compiler.ts            — orchestrator: parse → lower → transform → emit → link (~200 lines)
  hir/
    types.ts             — HIR node definitions (~500-800 lines)
    lower.ts             — SWC AST → HIR lowering (~2-3K lines, the big one)
    lower-class.ts       — class/interface lowering (~500 lines)
    lower-types.ts       — TS type annotation → HIRType resolution (~300 lines)
  transforms/
    integer-narrowing.ts — narrow f64 → i32 when provably integer (~500 lines, THE secret sauce)
    box-insertion.ts     — insert box/unbox at type boundaries (~400 lines)
    closure-conversion.ts — closure capture + rewrite (~500 lines)
    async-lowering.ts    — async → state machine (~800 lines)
    inlining.ts          — function inlining (~400 lines)
    escape-analysis.ts   — stack allocation for non-escaping objects (~300 lines)
  codegen/
    llvm-bridge.c        — C bridge wrapping LLVM C API (~500-800 lines)
    emitter.ts           — HIR → LLVM via C bridge calls (~2-3K lines)
    runtime-decls.ts     — extern declarations for C bridges (~300 lines)
    nan-boxing.ts        — box/unbox helpers (~200 lines)
    struct-layout.ts     — class/interface struct definitions (~400 lines)
swc-bridge/
  src/lib.rs             — Rust FFI: swc_ecma_parser → JSON AST (~50-100 lines)
  Cargo.toml             — deps: swc_ecma_parser, serde_json
  build.sh               — cargo build --release → libswc_bridge.a
```

Estimated total new code: **~15-20K lines** (vs 67K lines of v1 codegen).

## Decisions (Locked)

1. **Separate `v2` branch in existing repo.** Own CI config that only runs v2 tests/builds. v1 stays on `main` untouched.
2. **Self-hosting is a victory lap (Phase 9), not a design constraint.** No "every feature must work in two compilers" tax during development. Once Phases 1-8 are solid, self-host via Rust FFI bridge to SWC (~50 lines of Rust + yyjson for JSON AST parsing).
3. **SWC → ChadScript AST → HIR.** Thin SWC-to-ChadScript-AST adapter. All 21 semantic passes keep working with zero changes. Consolidate later.
4. **Boehm GC for now.** Simple, works. Precise GC is Phase 8+. Boehm only hurts on allocation-heavy benchmarks.
5. **Node compat is a goal.** Start with 15-20 core modules (fs, path, http, crypto, child_process, Buffer, process, console, JSON, RegExp, Map, Set, Promise, setTimeout, events), then expand. Each new module is incremental — just more runtime_call targets.

## Node Compat Test Strategy

**Goal:** Run Bun's 227 Node compat tests (and eventually test262) directly against ChadScript to get a real compatibility score — no manual porting.

**Why not today:** Three blockers — no module system (`import { expect } from "bun:test"`), no closures (`describe(() => { test(() => { ... }) })`), no stdlib APIs (the things the tests actually test). Even a preprocessor shim can't help when the test bodies exercise APIs that don't exist yet.

**Phased approach:**

1. **Now (Phases 0-4):** Standalone `.ts` parity fixtures diffed against `node --experimental-strip-types`. This is the existing 46-test pattern — scale it up as features land. Each new feature gets hand-written fixtures exercising edge cases from test262/Bun test catalogs.

2. **Phase 5 (closures):** ChadScript gains `describe(() => { test(() => { ... }) })`. Ship a minimal `bun:test` shim as a ChadScript stdlib module (~20 lines):

   ```typescript
   function describe(name: string, fn: () => void): void {
     fn();
   }
   function test(name: string, fn: () => void): void {
     fn();
   }
   function expect(val: any): any {
     return {
       toBe(x: any) {
         if (val !== x) throw "fail";
       } /* ... */,
     };
   }
   ```

   At this point Bun test files can parse and run structurally — the `describe`/`test`/`expect` wrappers work, even if the APIs under test aren't all there yet. Gives us a skip/pass/fail count per category.

3. **Phase 6 (stdlib):** Each new module (fs, path, crypto, etc.) immediately unlocks the corresponding Bun compat tests. Add `chad2 test:compat` command that:
   - Discovers `tests/compat/` fixtures (auto-tagged with `// @requires: closures, fs, arrays`)
   - Skips tests for unimplemented features
   - Reports pass/fail/skip per category
   - Compares against `node` output for parity

4. **Phase 9 (polish):** Port test262 `test/language/` and `test/built-ins/` for language semantics coverage. These are self-contained (no framework), just need `assert.js` → ChadScript shim.

**Sources:**

- Bun (`/Users/csmith/git/bun/test/js/node/`): 227 files, 59 categories (fs=23, path=21, process=38, crypto=16, child_process=18, http=25). Jest-style → shim.
- Node (`/Users/csmith/git/node/test/parallel/`): 3,860 tests. Heavy on internals but exhaustive.
- test262 (github.com/tc39/test262): Authoritative for language semantics.

**Key constraint:** Every test must eventually compile and run as a ChadScript native binary. The shim approach means zero manual porting — just point ChadScript at the real test files.

## Verification

Each phase has a concrete milestone. Verification at each phase:

1. Run existing test fixtures against new compiler (progressive pass rate)
2. Run benchmarks against v1 (no regressions on numeric perf)
3. New parity tests: compare output against `node` for the same input
4. Node compat score: % of Bun/test262 tests passing (tracked per phase from Phase 5+)
5. No self-hosting requirement (removed)

End-state verification:

- `npm test` passes 95%+ of existing 718 fixtures
- Benchmarks: fib ≤ 170ms, monte carlo ≤ 25ms, startup ≤ 2ms (match or beat v1)
- Object allocation benchmark competitive (within 2x of box-first compilers thanks to future precise GC)
- Node compat: ≥80% of Bun's 227 Node compat tests passing by end of Phase 6
- Real programs compile and run: HTTP server, CLI tool, file processor

## LOC + Timeline Estimate

| Phase                   | LOC         | Calendar        |
| ----------------------- | ----------- | --------------- |
| 0: Scaffold             | ~1K         | 1 week          |
| 1: Numeric core         | ~3-4K       | 2 weeks         |
| 1.5: LLVM C API swap    | ~1-2K       | 1 week          |
| 2: Strings + arrays     | ~4-5K       | 2 weeks         |
| 3: Classes + interfaces | ~4-5K       | 2-3 weeks       |
| 4: Closures + async     | ~4K         | 2-3 weeks       |
| 5: Language gaps        | ~2-3K       | 1-2 weeks       |
| 6: NaN-boxing escape    | ~3-4K       | 2 weeks         |
| 7: Stdlib               | ~8-10K      | 4-6 weeks       |
| 8: Self-hosting         | ~500        | 2-3 weeks       |
| 9: Optimization         | ~3K         | 2-3 weeks       |
| 10: Polish + parity     | ~2K         | ongoing         |
| **Total**               | **~35-46K** | **~6-7 months** |

This is aggressive but realistic. v1 is 100K+ LOC. The HIR layer means each line does more — no string concatenation, no scattered type resolution, no dispatch ladders.
