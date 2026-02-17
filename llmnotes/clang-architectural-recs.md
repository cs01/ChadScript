# ChadScript Architecture & Roadmap

## Clang Reference Model

```
Source → Driver → Lexer/Preprocessor → Parser ←→ Sema → AST → ASTConsumer → CodeGen → LLVM → Binary
```

| Abstraction | Purpose | ChadScript Equivalent |
|-------------|---------|----------------------|
| `ASTContext` / `QualType` | Canonical type system, pointer equality | `TypeContext` + `resolveExpressionType()` |
| `DeclContext` | Hierarchical scope tree for name lookup | `SymbolTable.pushScope()/popScope()` |
| `Sema` | Type authority — annotates AST, codegen trusts it | `SemanticAnalyzer` (codegen ignores it, re-infers everything) |
| `CodeGenModule` / `CodeGenFunction` | Module vs function-level codegen | `LLVMGenerator` / `FunctionGenerator` |

## Current Architecture

```
Source (.ts/.js)
    ↓
Parser (TS API or tree-sitter) → AST
    ↓
SemanticAnalyzer → DiagnosticEngine, type inference, symbol export
    ↓
LLVMGenerator
  ├── 25+ sub-generators via IGeneratorContext
  ├── TypeContext (canonical ResolvedType intern pool)
  ├── TypeInference.resolveExpressionType() → ResolvedType
  ├── SymbolTable (hierarchical scopes, ResolvedType cache)
  ├── VariableAllocator (resolved path for 19 node types, predicate fallback for 2)
  └── String-based IR emission + terminator classification
    ↓
.ll → opt → llc → clang → Binary
```

### Deliberate Trade-offs

| Decision | Why |
|----------|-----|
| String-based IR emission | Self-hostable without LLVM C++ dependency |
| Whole-program compilation | Fine at current scale (~5K lines) |
| No intermediate IR | Direct AST → LLVM IR; only needed for ChadScript-level optimization |

---

## Blocked Items

### binary/conditional in VariableAllocator

`binary` (`||`) and `conditional` (`?:`) are the last 2 node types still using predicate fallback instead of `resolveExpressionType()` dispatch.

**Why blocked:** Resolving `||` changes `isObjectExpression` behavior (it calls `resolveExpressionType` at the top for all types). When `x || []` newly resolves to object, `allocateObject` preempts `allocatePointer`, causing IR type mismatches and Stage 1 segfaults.

**To unblock:** Decouple `isObjectExpression` from `resolveExpressionType` for binary nodes, OR eliminate the `isPointerOrExpression` / `allocatePointer` code path entirely.

### Expression Type Caching

No viable cache key exists. `loc.offset` is never populated by the parser (all `undefined`). `Map<Expression, ResolvedType>` with object keys can't self-host (native compiler only supports string/number-keyed Maps).

**To unblock:** Add integer node IDs during parsing (`nodeId: number` counter in transformer), OR populate `loc.offset` from tree-sitter's `startIndex`.

**Priority:** Low. `resolveExpressionType()` is already O(1) for most node types. Caching is a perf optimization, not a correctness issue.

### Native Compiler Map Limitations

1. Can't dispatch `.get()`/`.set()` on a Map returned from a function — only on `new Map()` or known fields
2. Only string/number keys — no object/pointer-keyed Maps

**Impact:** Forces `SemaSymbolData` parallel-array serialization. Blocks expression type caching.

---

## Open Gaps

### SymbolKind / ResolvedType Divergence

`SymbolKind` and `ResolvedType` are set independently per symbol. They agree for the resolved path, but declared-type overrides and the 2 remaining unsafe node types don't populate `resolvedType`.

**Fix:** Derive `SymbolKind` from `resolvedType`. Expand caching to cover declared-type overrides.

### Sema Bridge Is No-Op

Sema exports symbols → `prePopulateFromSema()` pre-seeds SymbolTable → codegen immediately overwrites them. Three problems:

1. **Flat namespace** — sema has no scope stack, so function-local symbols are discarded at the bridge
2. **Codegen re-infers everything** — doesn't consult sema before running its own type inference
3. **Ugly serialization** — `SemaSymbolData` uses 5 parallel arrays because native compiler can't dispatch Map methods on return values

---

## Next Steps

### 1. Unblock binary/conditional (highest impact)

Refactor `isObjectExpression` to not call `resolveExpressionType` for binary nodes, or merge `allocatePointer` into resolved-type dispatch. This gets the last 2 node types off predicate fallback and into the unified path.

### 2. Predicate elimination

Once all node types use the resolved path, the `is*Expression()` predicates become dead code. Remove them and have `VariableAllocator` dispatch entirely on `ResolvedType`.

### 3. AST node IDs (parser change)

Add `nodeId: number` to AST nodes during parsing (simple counter in transformer). Unblocks expression type caching and any future per-node annotation (sema types, source maps, etc.).

### 4. Scope-aware sema

Give `SemanticAnalyzer` a scope stack parallel to SymbolTable. Make codegen consult sema before re-inferring types. Eventually sema annotates AST nodes directly and codegen stops inferring.

### 5. Map return-type tracking

Track return types through method calls in `method-calls.ts` so that `functionReturningMap().get()` works. Unblocks `SemaSymbolData` cleanup and sema bridge improvements.

---

## Native Compiler Constraints (self-hosting)

These constraints affect any code that must compile through the native compiler:

- No `for...of`, no `?.`, no `??`, no destructuring
- `switch` IS supported
- No `Map.get()`/`.set()` on return values — only on known fields or `new Map()`
- No `includes()` — use `indexOf() !== -1`
- Class field default initializers work for simple types (literals, `new`, arrays, unary) — complex initializers (object literals, arrow functions) are not yet supported
- Constructor type args (`new Set<string>()`) behave differently from declared types (`const x: Set<string> = new Set()`) — the former can segfault
