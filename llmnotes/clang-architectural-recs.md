# ChadScript vs Clang: Architecture Reference

How ChadScript maps to Clang's architecture. Use this to understand design decisions and identify what to work on next.

---

## Clang Architecture (Reference Model)

```
Source Code
    ↓
Driver (arg parsing, job orchestration)
    ↓
CompilerInstance (central coordinator)
    ↓
Lexer → Preprocessor → Token Stream
    ↓
Parser (recursive descent) ←→ Sema (semantic analysis, interleaved)
    ↓
AST (immutable, source-faithful, type-annotated)
  ├── ASTContext (type dedup, memory arena, canonical types)
  ├── Decl/Stmt/Expr class hierarchies
  ├── QualType (canonicalized, qualified types)
  └── SourceLocation on every node
    ↓
ASTConsumer (pluggable — codegen, analysis, tooling)
    ↓
CodeGen (AST → LLVM Module, in-process)
    ↓
LLVM Pass Manager (optimization, in-process)
    ↓
Backend → Object Code → Linker
```

### Clang Key Abstractions

| Abstraction | Purpose |
|-------------|---------|
| `CompilerInstance` | Central coordinator, owns all components |
| `DiagnosticEngine` | Unified error/warning reporting with source locations and fix-it hints |
| `SourceLocation` | Compact 32-bit encoding (file + offset) on every AST node |
| `SourceManager` | Maps files to memory, resolves locations, tracks macro expansion |
| `ASTContext` | Type canonicalization, memory arena, declaration maps |
| `QualType` | Canonicalized type with const/volatile qualifiers; pointer equality for comparison |
| `DeclContext` | Hierarchical scope tree (functions, blocks, classes, namespaces) |
| `Sema` | Full semantic analysis: overload resolution, template instantiation, implicit conversions |
| `ASTConsumer` | Abstract interface for AST consumers (codegen, analysis, tooling) |
| `CodeGenModule` / `CodeGenFunction` | Clear separation between module-level and function-level codegen |

---

## ChadScript Architecture (Current)

```
Source Code (.ts/.js)
    ↓
Driver (chadc-node.ts or chadc-native.ts)
    ↓
Parser (TS API or tree-sitter) → Custom AST
  ├── SourceLocation on every node
  ├── Discriminated unions (Expression, Statement)
  ├── ASTConsumer + RecursiveASTVisitor (ast/visitor.ts)
  └── Dual parser backends for self-hosting
    ↓
SemanticAnalyzer (analysis/semantic-analyzer.ts)
  ├── DiagnosticEngine with clang-style error formatting
  ├── Type inference, unreachable code, missing returns
  ├── checkUnsafeUnionType validation
  └── Symbol output → SemaSymbolData → codegen (Phase 2)
    ↓
TS TypeChecker (optional, .ts only)
    ↓
LLVMGenerator (monolithic orchestrator)
  ├── 25+ sub-generators via IGeneratorContext
  ├── FunctionGenerator (function-level codegen)
  ├── Hierarchical SymbolTable (pushScope/popScope)
  ├── TypeContext (canonical type intern pool)
  ├── prePopulateFromSema() — pre-seeds SymbolTable with sema types
  ├── String-based type system (being migrated to TypeContext)
  ├── String-based IR emission with structured terminator classification
  └── DWARF debug info (-g flag)
    ↓
.ll file → opt → llc → clang/gcc → Binary
```

### ChadScript-to-Clang Mapping

| Clang Concept | ChadScript Equivalent | Notes |
|---------------|----------------------|-------|
| `CompilerInstance` | `compile()` / `compileNative()` | Procedural, not a class |
| `DiagnosticEngine` | `src/diagnostics/engine.ts` | Clang-style caret output, `SourceLocation`, suggestions. Wired into codegen via `emitError`/`emitWarning`. |
| `SourceLocation` | `SourceLocation` on every AST node | Used for diagnostics + DWARF debug info |
| `SourceManager` | None | File management is ad-hoc |
| `ASTContext` / `QualType` | `TypeContext` (type-context.ts) | Intern pool with canonical `ResolvedType` objects. Wired into `SymbolTable` and `IGeneratorContext`. Singletons for number/string/boolean/void. Factory methods for array/map/set types. Not yet used for type comparison (still string-based). |
| `DeclContext` | `SymbolTable` with `pushScope()`/`popScope()` | Hierarchical lookup, closure capture |
| `Sema` | `SemanticAnalyzer` | Validates and exports symbol types. Output threaded to codegen via `SemaSymbolData` (Phase 2). Codegen pre-populates `SymbolTable` but still re-infers most types. See gap #1 for what remains. |
| `ASTConsumer` | `ASTConsumer` interface in `ast/visitor.ts` | Available but not widely used |
| `RecursiveASTVisitor` | `RecursiveASTVisitor` in `ast/visitor.ts` | Full visitor with overridable methods |
| `CodeGenModule` | `LLVMGenerator` (extends `BaseGenerator`) | Module-level: globals, structs, declarations |
| `CodeGenFunction` | `FunctionGenerator` | Function-level: params, entry block, returns |

### What ChadScript Does Well

1. **Demand-driven linking** — only links libraries actually used
2. **Alloca hoisting** — hoists to function entry for `mem2reg`
3. **Single-pass codegen** — AST → IR in one pass
4. **GC as memory model** — valid for a JS-like language
5. **Two-parser self-hosting** — TS API for node, tree-sitter for native
6. **Narrow local context interfaces** — sub-generators declare only what they need
7. **Structured terminator classification** — parallel `outputIsTerminator[]` avoids re-parsing IR strings
8. **DWARF debug info** — `-g` flag, source-level debugging works

### Deliberate Trade-offs (Not Gaps)

| Decision | Why |
|----------|-----|
| String-based IR emission | Makes the compiler self-hostable (no LLVM C++ dependency). Terminator classification mitigates the parsing downside. |
| Whole-program compilation | Fine at current program sizes (~5K lines). Separate compilation is a scaling concern, not a correctness concern. |
| No intermediate ChadScript IR | Direct AST → LLVM IR. Only needed if we add ChadScript-level optimization or retargeting. |

---

## Open Gaps (What to Work On)

### 1. ~~Bridge Semantic Analysis to Codegen~~ ⚠ Phase 2 Done — Plumbing Works, Architecture Needs Work

**What's done (Phase 2).** Sema's symbol output now flows through both compiler drivers into `LLVMGenerator.prePopulateFromSema()`, which pre-seeds the `SymbolTable` with type/kind info for top-level variables. Self-hosting works — Stage 0 → 1 → 2 all pass.

**Honest assessment.** The bridge exists but it's a rickety one. Three things to be candid about:

1. **Self-hosting forced an ugly serialization layer.** The native compiler can't call `Map.get()` on a value returned from a method (it doesn't track return types for Map dispatch). So we had to:
   - Define `SemaSymbolData` as parallel arrays (names[], types[], llvmTypes[], schemaKeys[], schemaTypes[])
   - In `compiler.ts` (Node.js): flatten via `Map.forEach()`
   - In `native-compiler-lib.ts` (native): add 4 accessor methods to `SemanticAnalyzer` (`getSymbolTypeByName`, `getSymbolLlvmTypeByName`, etc.) that call `this.symbols.get()` internally (works because `this.symbols` is a known Map field)
   - In `LLVMGenerator`: store as 5 parallel arrays + count, do O(n*m) linear scans for name lookup
   - This is plumbing that exists solely because of self-hosting limitations, not because it's good design.

2. **Only top-level variables are bridged.** Sema's symbol map is a flat namespace including function-local vars. Pre-populating those as global symbols caused empty-alloca explosions (codegen found symbols before allocating them). The fix was to filter to only `ast.topLevelStatements` with `type === 'variable_declaration'`. Function-local type info — which is the majority of what sema knows — is still discarded.

3. **Codegen ignores the hints anyway.** The pre-populated symbols get overwritten the moment codegen processes each `let`/`const` declaration. The type info "hint" only matters in the narrow window between pre-population and the declaration being processed, which is nearly zero for top-level sequential code. In practice, this bridge currently has no observable effect on codegen behavior.

**What would make this something to be proud of:**

- **Phase 2a: Scope-aware sema symbols.** `SemanticAnalyzer` needs to track scope (function name, nesting depth) per symbol so we can pre-populate function-local symbols into the right scope at the right time, not just top-level globals. This is the fundamental data model gap.

- **Phase 2b: Codegen consults sema before re-inferring.** When codegen encounters a variable it hasn't allocated yet, it should check sema's type info first rather than running its own multi-step inference (`TypeInference.isStringExpression()` → `TypeResolver` → `TypeChecker` → guess). This means `VariableAllocator` and `TypeInference` need to read sema hints.

- **Phase 2c: Eliminate the parallel-array serialization.** Once the native compiler gains return-type tracking for method dispatch (so `Map.get()` works on any Map, not just field Maps), replace `SemaSymbolData` with direct Map passing. The 5-array + 4-accessor-method pattern is self-hosting debt that should be retired.

- **Phase 2d: Sema as authority, not hint.** The real goal is Clang's model: sema annotates the AST with types, codegen trusts them. This requires either (a) sema writing types back onto AST nodes (type-annotated AST), or (b) sema producing a parallel type map keyed by AST node ID rather than variable name. Either way, codegen stops re-inferring and just reads. This is a large architectural shift but it's the destination.

### 5. Native Compiler Map Dispatch Limitation

**The problem.** The native compiler can only dispatch Map/Set methods (`.get()`, `.set()`, `.has()`, etc.) when it statically knows the variable is a Map — i.e., when the variable was assigned `new Map()` or is a class field typed as `Map`. It cannot dispatch on a Map returned from a function call because it doesn't track return types.

**Impact.** This forced the `SemaSymbolData` parallel-array pattern and the accessor-method workaround in Phase 2. It will continue to force awkward workarounds whenever cross-module data needs to flow via Maps.

**What to do.** Add return-type inference to the native compiler's method dispatch. When `analyzer.getSymbols()` is called and `SemanticAnalyzer.getSymbols()` has return type `Map<string, TypedSymbol>`, the compiler should track the result as a Map and allow `.get()` dispatch on it. This is a codegen feature, not a sema feature — it goes in `method-calls.ts` return-type tracking.

### 6. Sema's Flat Symbol Namespace

**The problem.** `SemanticAnalyzer` stores all symbols in a single `Map<string, TypedSymbol>` regardless of scope. A variable `x` inside `function foo()` and a top-level `x` share the same namespace. The last one written wins.

**Impact.** This made Phase 2's bridging fragile — we could only safely pre-populate top-level symbols. Function-local type info (the majority of what sema knows) is discarded at the bridge boundary.

**What Clang does.** `DeclContext` is a hierarchical tree. Each scope (function, block, class) is a `DeclContext` node. Name lookup walks the tree from innermost to outermost. There's never ambiguity about which `x` you mean.

**What to do.** Give `SemanticAnalyzer` a scope stack (parallel to codegen's `SymbolTable.pushScope()`/`popScope()`). Either:
- (a) Key the symbol map by `(functionName, varName)` tuples — simple, handles one level of nesting
- (b) Build a proper scope tree — more correct, handles nested functions and blocks
- Either way, the output format changes from `Map<string, TypedSymbol>` to something scope-aware that codegen can consume per-function.

### 2. ~~Canonical Type Representation~~ ✓ Foundation Laid (TypeContext Active)

**Progress.** `TypeContext` (type-context.ts) now exists as an intern pool with canonical `ResolvedType` objects — one per unique type. Pre-cached singletons for `numberType`, `stringType`, `booleanType`, `voidType`, `nullType`, `unknownType`. Factory methods for `getArrayType()`, `getMapType()`, `getSetType()`, `getInterfaceType()`, `getClassType()`. `resolvedTypeToLlvm()` provides a parallel LLVM type mapping path alongside the string-based `tsTypeToLlvm()`.

`TypeContext` is non-optional on `IGeneratorContext` and wired into `SymbolTable` (constructor parameter, propagated through `clone()`). `Symbol` objects carry a `resolvedType?: ResolvedType` field (currently `undefined` — will be populated by Phase 3's `inferTsType()`).

**What remains**: Types are still compared as strings everywhere. The `is*Expression()` methods in `TypeInference` still return booleans via string checks. Phase 3 will add `inferTsType()` which populates `resolvedType` on symbols and caches results through `TypeContext`. Phase 4 will convert codegen decision points to read cached types instead of calling multiple `is*` methods.

### 3. ~~Migrate Codegen Errors to DiagnosticEngine~~ ✓ DONE

**Completed.** Added `emitError(msg, loc?, suggestion?): never` and `emitWarning()` to `IGeneratorContext`. `LLVMGenerator` implementation formats errors through `DiagnosticEngine` with file:line:column carets. Migrated ~80 user-facing `throw new Error` sites across 15 codegen files to use `emitError` with `SourceLocation` from AST nodes. Retired the legacy `formatCodegenError()` helper. Internal compiler assertions (LLVM IR validation in `base-generator.ts`) intentionally remain as `throw new Error`.

### 4. ~23 Remaining IGeneratorContext Wrappers

**The situation**: `IGeneratorContext` still has ~23 forwarding wrappers for `classGen` (6), `typeResolver` (10), and `interfaceStructGen` (7). These are consumed through narrow local context interfaces in 12+ sub-generator files.

**Why they stay**: Converting them would widen those narrow interfaces. The current pattern (narrow interfaces declaring only what's needed) is actually closer to Clang's module boundary design. These are architecturally justified, not technical debt.
