# ChadCheck: Native TypeScript Type Checker

## Vision

Two strategies to get a native TypeScript type checker:

| Strategy | Approach | Pros | Cons |
|----------|----------|------|------|
| **A: Compile tsc** | Expand ChadScript to compile Microsoft's tsc | Full TS for free | Big ChadScript expansion |
| **B: Build fresh** | Write type checker in strict TS, compile with ChadScript | Ship faster, designed for threads | Reimplementing the wheel |

**The insight:** Strategy B teaches us what ChadScript is missing. Each gap we fill brings us closer to compiling tsc itself.

```
Strategy B (learning)  →  Expand ChadScript  →  Strategy A (full tsc)
```

## Prerequisites

1. ⬜ Complete AGENT_TASK.md (self-hosting with tree-sitter)
2. ⬜ Add pthread bindings to ChadScript
3. ⬜ Add worker pool / channels

## What's Needed to Compile TSC?

| Pattern | ChadScript Status | Needed For |
|---------|-------------------|------------|
| Classes with private fields | ✅ Yes | Core tsc |
| Getters/setters | ⬜ Partial | Type nodes |
| Symbol/WeakMap | ⬜ No | Internal caching |
| Generators/iterators | ⬜ No | AST traversal |
| Spread in objects | ⬜ No | Options merging |
| Namespace merging | ⬜ No | ts.* namespace |
| Enums (const, computed) | ⬜ Partial | SyntaxKind |

**Key insight:** Complex TS features (conditional types, mapped types) are type-level only and get erased. The *runtime* patterns matter more.

---

## Roadmap

### Phase 0: Threading in ChadScript

**0.1 pthread bindings** (`src/codegen/stdlib/pthread.ts`)
```typescript
declare function pthread_create(thread: ptr, attr: ptr, fn: ptr, arg: ptr): number;
declare function pthread_join(thread: ptr, retval: ptr): number;
declare function pthread_mutex_lock(mutex: ptr): number;
```

**0.2 Worker pool abstraction**
```typescript
const pool = new WorkerPool<string, CheckResult>(4);
const results = await pool.map(files, checkFile);
```

**Files:** `src/codegen/stdlib/pthread.ts` (NEW), `src/compiler.ts` (link -lpthread)

---

### Phase 1: Minimal Type Checker (v0.1)

Strict subset of TypeScript, no `any`:

**Supported:** primitives, `T[]`, objects, functions, classes, generics, unions

**Not supported (v0.1):** conditional/mapped types, `any`/`unknown`, `infer`/`keyof`/`typeof`

**Architecture:**
```
chadcheck/src/
├── main.ts         # CLI
├── parser.ts       # Tree-sitter (from self-hosting)
├── types.ts        # Type representation
├── checker.ts      # isSubtypeOf(), inference
├── symbols.ts      # Symbol table + scopes
└── diagnostics.ts  # Error output
```

**Core algorithms:**
- `isSubtypeOf(source, target)` - structural comparison
- Type inference - literal widening, contextual typing
- Generic instantiation - constraint satisfaction

---

### Phase 2: Expand via tsc Gaps

Try compiling pieces of tsc. Each failure → feature for ChadScript.

**Method:**
1. Take a tsc module (e.g., `scanner.ts`)
2. Try to compile with ChadScript
3. Hit error → add feature
4. Repeat

**Priority:** `scanner.ts` → `parser.ts` → `types.ts` → `checker.ts`

---

### Phase 3: Control Flow Analysis

- Build control flow graph with antecedent links
- Type guards: `typeof`, `instanceof`, `!== null`
- Narrowing: walk antecedent chain, intersect with guards

---

### Phase 4: Parallelization

**File-level parallelism:**
- Parse all files in parallel (tree-sitter is thread-safe)
- Build dependency graph
- Type-check independent modules in parallel

**Immutable types:**
- Types are value types (no mutation)
- Safe to share across threads without locks

**Work stealing:**
- Dynamic load balancing
- Threads grab work from shared queue

---

### Phase 5: CLI & Integration

```bash
chadcheck src/           # Check all .ts files
chadcheck --watch src/   # Watch mode
chadcheck --project .    # Use tsconfig.json
```

**Stretch:** LSP server for IDE integration

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Speed vs tsc | 10x faster |
| Speed vs tsc-go | 1.5-2x faster (LLVM advantage) |
| Correctness | 80% of TS conformance tests |

---

## Immediate Next Steps

1. **Finish AGENT_TASK.md** - self-hosting is prerequisite
2. **Add pthread bindings** - `src/codegen/stdlib/pthread.ts`
3. **Create `chadcheck/` directory** - scaffold the type checker
4. **Implement `types.ts`** - type representation
5. **Implement `checker.ts`** - start with primitives only
6. **Test on simple programs** - `const x: string = 5;` should error

---

## Verification

After each phase:
1. Run `npm run test:fast` (ChadScript tests)
2. Run chadcheck on test fixtures
3. Compare output to tsc on same fixtures
4. Benchmark: `time chadcheck large-project/` vs `time tsc --noEmit`
