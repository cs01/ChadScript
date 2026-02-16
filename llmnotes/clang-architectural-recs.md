# ChadScript Architecture — Current State & Next Steps

---

## Clang Reference Model

```
Source → Driver → Lexer/Preprocessor → Parser ←→ Sema → AST → ASTConsumer → CodeGen → LLVM → Binary
```

| Abstraction | Purpose |
|-------------|---------|
| `ASTContext` / `QualType` | Canonical type system — one representation, pointer equality |
| `DeclContext` | Hierarchical scope tree for name lookup |
| `Sema` | Type authority — annotates AST, codegen trusts it |
| `CodeGenModule` / `CodeGenFunction` | Module vs function-level codegen separation |

---

## ChadScript Current Architecture

```
Source (.ts/.js)
    ↓
Parser (TS API or tree-sitter) → AST with SourceLocation
    ↓
SemanticAnalyzer → DiagnosticEngine, type inference, symbol export
    ↓
LLVMGenerator
  ├── 25+ sub-generators via IGeneratorContext
  ├── TypeContext (canonical ResolvedType intern pool)
  ├── TypeInference.resolveExpressionType() → ResolvedType
  ├── SymbolTable (hierarchical pushScope/popScope)
  ├── prePopulateFromSema() (top-level only, currently no-op in practice)
  ├── String-based IR emission + terminator classification
  └── DWARF debug info (-g)
    ↓
.ll → opt → llc → clang → Binary
```

### Clang Mapping

| Clang | ChadScript | Gap |
|-------|-----------|-----|
| `ASTContext`/`QualType` | `TypeContext` + `resolveExpressionType()` | Variable nodes fully migrated; method_call/member_access still have string fallbacks |
| `DeclContext` | `SymbolTable.pushScope()/popScope()` | Codegen has scopes; sema has flat namespace |
| `Sema` as type authority | `SemanticAnalyzer` | Bridge exists but codegen ignores it — re-infers everything |
| `CodeGenModule`/`CodeGenFunction` | `LLVMGenerator`/`FunctionGenerator` | Clean |

### What Works Well

1. **Demand-driven linking** — only links libraries actually used
2. **Alloca hoisting** — hoists to function entry for `mem2reg`
3. **Single-pass codegen** — AST → IR in one pass
4. **Two-parser self-hosting** — TS API for node, tree-sitter for native
5. **Narrow local context interfaces** — sub-generators declare only what they need
6. **Structured terminator classification** — `outputIsTerminator[]` avoids re-parsing IR
7. **Unified expression type resolution** — `resolveExpressionType()` resolves any AST node to canonical `ResolvedType`; 13 predicates rewritten as thin wrappers
8. **Clang-style diagnostics** — `emitError`/`emitWarning` with source location carets

### Deliberate Trade-offs

| Decision | Why |
|----------|-----|
| String-based IR emission | Self-hostable without LLVM C++ dependency |
| Whole-program compilation | Fine at current scale (~5K lines) |
| No intermediate IR | Direct AST → LLVM IR; only needed for ChadScript-level optimization |

---

## Open Gaps

### A. SymbolTable Kind/Type Inconsistency

A variable can have `SymbolKind.Object` but LLVM type `%StringArray*`. Kind and LLVM type are set independently and can disagree. `resolveVariableType()` works around this with a fragile priority ordering (unambiguous LLVM types first, then kind, then ambiguous `i8*` last).

**Fix:** Replace `SymbolKind` + LLVM type string with a single `ResolvedType` on each symbol. `SymbolKind` becomes redundant once `ResolvedType` is the authority.

### B. VariableAllocator's 13-Predicate Priority Chain

`VariableAllocator` calls all 13 `is*Expression()` predicates eagerly for every variable declaration, then dispatches through a 26-branch if/else chain. This is the primary consumer of `resolveExpressionType()` but doesn't use it directly yet.

**Fix:** Replace the 13-predicate chain with a single `resolveExpressionType()` call + switch on `resolved.base` and `resolved.arrayDepth`.

### C. Predicate Fallback Logic

For `variable` nodes, predicates fully trust `resolveExpressionType()`. For `method_call`, `member_access`, `binary`, and `conditional` nodes, they still have old string-based fallback logic. The old logic has quirks (e.g., `isArrayExpression` uses `endsWith('[]')` which matches ALL array types) that cascade through the VariableAllocator priority chain.

**Fix:** Can only be removed after VariableAllocator migrates (Gap B). Once VariableAllocator uses `resolveExpressionType()` directly, the predicate fallbacks become dead code.

### D. Native Compiler Map Limitations

Two problems: (1) Can't dispatch `.get()`/`.set()` on a Map returned from a function call — only on `new Map()` or known Map fields. (2) Only supports string keys — no object/pointer-keyed Maps.

**Impact:** Forced `SemaSymbolData` parallel-array serialization. Blocks expression type caching (`Map<Expression, ResolvedType>` needs object keys).

**Fix:** (1) Add return-type tracking to `method-calls.ts` so method return types propagate. (2) Add pointer-keyed Map support using pointer value as hash key.

### E. Sema Bridge Is No-Op

Sema exports symbols → `prePopulateFromSema()` pre-seeds SymbolTable → codegen immediately overwrites them when processing each declaration. The bridge has no observable effect.

Three sub-problems:
1. **Sema has flat namespace** — `Map<string, TypedSymbol>` with no scope. Function-local symbols (the majority) are discarded at the bridge boundary.
2. **Codegen re-infers everything** — doesn't consult sema before running its own type inference.
3. **Ugly serialization** — `SemaSymbolData` uses 5 parallel arrays + 4 accessor methods because native compiler can't dispatch Map methods on return values (Gap D).

**Fix:** Scope-aware sema (scope stack parallel to SymbolTable) → codegen consults sema before re-inferring → eventually sema annotates AST nodes directly and codegen stops inferring.

---

## Next Steps (Recommended Order)

The gaps have clear dependencies. Here's the order that maximizes impact:

### Step 1: VariableAllocator Migration (Gap B)

**Why first:** This is the payoff for Phase 3's `resolveExpressionType()` work. The 26-branch priority chain is the ugliest code in codegen and the primary consumer of all 13 predicates. Fixing it delivers immediate architectural improvement and makes Gaps A and C solvable.

**What to do:**
- In `VariableAllocator`, replace the 13 `is*Expression()` calls with one `resolveExpressionType()` call
- Dispatch on `resolved.base` + `resolved.arrayDepth`:
  - `string` + depth 0 → string variable
  - `string` + depth > 0 → string array
  - `number`/`boolean` + depth 0 → number variable
  - `number`/`boolean` + depth > 0 → number array
  - `Map` → map, `Set` → set, `RegExp` → regex
  - class/interface → struct pointer
  - object + depth > 0 → object array
  - default → i8* (string fallback)
- Keep old chain as dead-code fallback initially, delete once tests pass
- `resolveExpressionType()` returning null → fall back to old chain (shrinks over time)

**Risk:** Medium. The predicate quirks (e.g., `endsWith('[]')` matching all arrays) were load-bearing bugs. Need careful test verification.

### Step 2: SymbolTable ResolvedType (Gap A)

**Why second:** Once VariableAllocator uses `ResolvedType`, the SymbolTable should store `ResolvedType` too — so `resolveVariableType()` becomes a direct field read instead of the fragile priority-ordering dance.

**What to do:**
- Add `resolvedType: ResolvedType` to `Symbol` (field exists but is always `undefined`)
- When `VariableAllocator` sets a variable's type, also set `symbol.resolvedType`
- `resolveVariableType()` checks `symbol.resolvedType` first, falls back to LLVM type string
- Gradually make `SymbolKind` derived from `resolvedType` rather than independently set

### Step 3: Native Map Return-Type Tracking (Gap D.1)

**Why third:** Unblocks cleaner sema bridge (Gap E) and expression caching.

**What to do:**
- In `method-calls.ts`, when generating a method call, record the return type
- When the result is assigned to a variable, propagate the return type so `.get()` dispatch works
- This lets `SemaSymbolData` use Maps directly instead of parallel arrays

### Step 4: Expression Type Caching

**Why fourth:** With VariableAllocator migrated and SymbolTable carrying ResolvedType, caching becomes both possible and impactful.

**What to do:** Either add AST node integer IDs for `Map<number, ResolvedType>` caching (works with native compiler's string-key limitation), or wait for Gap D.2 (object-keyed Maps) and use `Map<Expression, ResolvedType>`.

### Step 5: Sema as Type Authority (Gap E)

**Why last:** This is the big architectural shift. Needs all prior gaps resolved first — VariableAllocator must accept `ResolvedType`, SymbolTable must store it, sema must have scopes, native compiler must handle Maps properly.

**What to do:**
- Give `SemanticAnalyzer` a scope stack
- Sema annotates AST nodes with `ResolvedType` (or produces scope-aware type map)
- Codegen reads types from sema instead of re-inferring
- Delete `TypeInference.is*Expression()` predicates entirely
