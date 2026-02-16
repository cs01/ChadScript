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
  ├── SymbolTable (hierarchical pushScope/popScope, ResolvedType cache)
  ├── VariableAllocator (resolveExpressionType for 19 node types, predicates for 2)
  ├── prePopulateFromSema() (top-level only, currently no-op in practice)
  ├── String-based IR emission + terminator classification
  └── DWARF debug info (-g)
    ↓
.ll → opt → llc → clang → Binary
```

### Clang Mapping

| Clang | ChadScript | Gap |
|-------|-----------|-----|
| `ASTContext`/`QualType` | `TypeContext` + `resolveExpressionType()` | All common node types migrated; only binary/conditional still use predicates |
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
9. **VariableAllocator uses ResolvedType** — 19 node types dispatch via `resolveExpressionType()` instead of 13 eager predicate calls; only binary/conditional still use predicate fallback
10. **SymbolTable ResolvedType cache** — `resolveVariableType()` checks cached `symbol.resolvedType` first; VariableAllocator populates cache after allocation

### Deliberate Trade-offs

| Decision | Why |
|----------|-----|
| String-based IR emission | Self-hostable without LLVM C++ dependency |
| Whole-program compilation | Fine at current scale (~5K lines) |
| No intermediate IR | Direct AST → LLVM IR; only needed for ChadScript-level optimization |

---

## Completed Steps

### Step 1: VariableAllocator Migration ✓

Replaced the 13 eager `is*Expression()` predicate calls with a single `resolveExpressionType()` call for safe node types. Initial safe list: variable, literals, new.

### Step 2: SymbolTable ResolvedType ✓

- `resolveVariableType()` checks `symbol.resolvedType` first as fast path before the priority chain
- VariableAllocator caches `resolved` on the symbol after allocation (when `useResolved` is true, no declared type override, not null literal)

### Step 3: Expand Safe Node Types ✓

Added `unary`, `this`, `call`, `method_call`, `index_access`, `type_assertion` to the safe list. Only `binary`, `conditional`, and `member_access` remained unsafe.

- `member_access` blocked by i8* ambiguity: `resolveMemberAccessType()` maps `getObjectPropertyType()` returning `i8*` to `stringType`, but `i8*` is also used for string arrays and other pointer types in object fields.
- `binary`/`conditional` blocked by wrong branch selection: `||` and ternary pick the first resolved branch, which can be wrong (e.g., empty `[]` default resolves to `number[]` instead of actual object array type).

### Step 4: Fix member_access Type Ambiguity ✓

Fixed `resolveMemberAccessType()` to correctly resolve object field types, unblocking `member_access` in the safe node type list. Two problems fixed:

1. **i8* ambiguity** — When `getObjectPropertyType()` returns `i8*`, now checks `getObjectMetadataTsTypes()` to disambiguate. If tsType is `string[]` → `getArrayType('string')`, if `number[]` → `getArrayType('number')`, etc. Only falls back to `stringType` when no tsType metadata exists.

2. **LLVM struct type pass-through** — Added explicit handling for `%StringArray*`, `%Array*`, `%ObjectArray*` property types (produced by `tsTypeToLlvmJson()` allocation paths). Previously these fell through to a metadata fallback that fed LLVM type strings into `typeContext.resolve()`, producing garbage ResolvedTypes like `{ base: '%StringArray*', arrayDepth: 0 }`.

3. **Metadata fallback prefers tsTypes** — The `getObjectMetadata()` fallback path now checks `objMeta.tsTypes[ki]` before `objMeta.types[ki]`, avoiding LLVM→ResolvedType translation errors.

All 19 common node types now use the resolved path. Only `binary` and `conditional` remain on predicate fallback.

---

## Open Gaps

### A. member_access Type Ambiguity — RESOLVED ✓

Fixed in Step 4. `resolveMemberAccessType()` now checks TS type metadata for `i8*` fields and handles `%StringArray*`/`%Array*`/`%ObjectArray*` property types directly. `member_access` added to safe node type list.

### B. binary/conditional Branch Selection

`resolveExpressionType()` for `binary` `||` and `conditional` nodes picks the first non-null resolved branch. This can select the wrong type (e.g., `ast ? ast.classes || [] : []` resolves the alternate `[]` to `number[]` instead of the actual object array type).

**Fix:** For `||`, check if either operand is an empty array literal `[]` and prefer the other operand's type. For conditional, require both branches to agree or return null.

### C. SymbolKind Still Independent of ResolvedType

`SymbolKind` and `ResolvedType` are set independently on each symbol. They agree for the resolved path, but declared-type overrides and the 2 remaining unsafe node types don't populate `resolvedType`.

**Fix:** Expand resolved-type caching to cover declared-type overrides. Eventually derive `SymbolKind` from `resolvedType` and remove the independent setting.

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

### Step 5: Fix binary/conditional Branch Selection (Gap B)

**Why next:** The last two node types not in the safe list. Adding them would mean ALL node types use `resolveExpressionType()`, eliminating the predicate fallback entirely.

**What to do:**
- For `||`, check if either operand is an empty array literal `[]` and prefer the other operand's type
- For conditional, require both branches to agree or return null
- Add `binary` and `conditional` to the safe node type list
- Test with full self-hosting chain

### Step 6: Native Map Return-Type Tracking (Gap D.1)

**Why next:** Unblocks cleaner sema bridge (Gap E) and expression caching.

**What to do:**
- In `method-calls.ts`, when generating a method call, record the return type
- When the result is assigned to a variable, propagate the return type so `.get()` dispatch works
- This lets `SemaSymbolData` use Maps directly instead of parallel arrays

### Step 7: Expression Type Caching

**Why next:** With VariableAllocator migrated and SymbolTable carrying ResolvedType, caching becomes both possible and impactful.

**What to do:** Add AST node integer IDs for `Map<number, ResolvedType>` caching (works with native compiler's string-key limitation), or wait for Gap D.2 (object-keyed Maps) and use `Map<Expression, ResolvedType>`.

### Step 8: Sema as Type Authority (Gap E)

**Why last:** This is the big architectural shift. Needs all prior gaps resolved first — VariableAllocator must accept `ResolvedType`, SymbolTable must store it, sema must have scopes, native compiler must handle Maps properly.

**What to do:**
- Give `SemanticAnalyzer` a scope stack
- Sema annotates AST nodes with `ResolvedType` (or produces scope-aware type map)
- Codegen reads types from sema instead of re-inferring
- Delete `TypeInference.is*Expression()` predicates entirely
