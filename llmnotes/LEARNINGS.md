# ChadScript Self-Hosting Learnings

## ✅ DO - Things That Work

1. **Hoist allocas to entry block** - All named allocas must be in the function entry block, not in conditional branches
2. **Store pointers as i8*** - Tree-sitter pointers must be stored as `i8*`, not `double` (loses precision)
3. **Check class before interface** - In member access, try `findClassImplementingInterface()` BEFORE `interfaceStructGen.hasInterface()`
4. **Load array values in objects** - When a variable reference is used as an object property value, load the actual array value, don't just pass the alloca
5. **Match type cast field order to object literal order** - When casting an object to access its fields, the field order in the type annotation must match the order fields were defined in the object literal, NOT the order in a TypeScript interface. Example: if object is created as `{ type, kind, name, value }`, cast must also have that order.

## ❌ DON'T - Mistakes to Avoid

1. **Don't emit `unreachable` at end of void functions** - Emit `ret void` instead, even after merge labels
2. **Don't use double for pointer storage** - 64-bit pointers need exact representation
3. **Don't prioritize interface struct layout over class layout** - Classes may have different field ordering
4. **Don't store alloca addresses in object fields** - Always load the value first
5. **Don't assume TypeScript interface field order matches object literal order** - ChadScript structs are laid out based on object creation order, not interface declaration order

## 🚨 CRITICAL - Interface Method Dispatch Struct Layout Mismatch

**Root Cause of Stage 0 Exit(1):**

When a class instance is stored in an interface-typed variable (e.g., `ctx: IGeneratorContext = new LLVMGenerator()`), calling methods on that variable causes crashes because:

1. **Interface struct layout ≠ Class struct layout**
   - `%AssignmentGeneratorContext` has 7 fields: `{ i8*, %ClassGeneratorLike*, i8*, %AST*, i8*, i8*, i8* }`
   - `%LLVMGenerator_struct` has 70+ fields
   - When code bitcasts between them, field accesses read garbage memory

2. **The problematic pattern:**
   ```llvm
   ; Load context (interface-typed)
   %ctx = load %AssignmentGeneratorContext*, %AssignmentGeneratorContext** %ctx.addr
   ; Bitcast to concrete class for method call
   %cast = bitcast %AssignmentGeneratorContext* %ctx to %LLVMGenerator_struct*
   ; Method accesses field 10 (symbolTable) - OUT OF BOUNDS!
   %field = getelementptr %LLVMGenerator_struct, %LLVMGenerator_struct* %cast, i32 0, i32 10
   ```

3. **Why this happens:**
   - TypeScript interfaces are compile-time type contracts, NOT runtime types
   - ChadScript treats interfaces as if they have their own struct with their own memory layout
   - When a `LLVMGenerator*` is passed as `IGeneratorContext*`, ChadScript stores it in interface-sized memory

**Workaround (current):** Add wrapper/delegate methods that don't access fields directly:
- `symbolTableIsClass(name)` instead of `symbolTable.isClass(name)`
- `getAst()` instead of `ast`
- These work because they're called on the concrete class, which has the right layout

**⚠️ WARNING: This workaround is NOT scalable!**
- generator-context.ts now has ~195 wrapper methods
- Every new generator method requires O(n) changes across interface, impl, mock, and sub-contexts
- DO NOT add more wrapper methods - fix the root cause instead

**Proper fixes (choose one):**

1. **Concrete Type Registry (CHOSEN - see docs/design/interface-dispatch-rfc.md)**
   - Track the concrete class behind every interface-typed variable at compile time
   - Symbol table has `concreteClass` field, `actualClassTypes` map tracks temp registers
   - Member access propagates concrete type to result temps via `setActualClassType()`
   - Method calls check `concreteClass` / `getActualClassType()` before AST scan
   - Enables chained access `a.b.c()` by flowing type info through intermediate results
   - Phase 1 prototype is implemented; wrapper methods can be removed incrementally

2. **Implement vtable-based dispatch (deferred)**
   - Interface types get a vtable pointer as their first field
   - All method calls go through the vtable
   - This is how C++ and other OOP languages solve this

3. **Always pass concrete type at call sites**
   - Transform interface-typed method calls at compile time
   - If `ctx: IGeneratorContext = new LLVMGenerator()`, replace `ctx.method()` with `(ctx as LLVMGenerator).method()`
   - Requires tracking the actual assignment chain

4. **Break the chain at codegen time** (simplest fix)
   - When encountering `a.b.c()`, generate intermediate assignments:
     ```llvm
     %tmp = load from a.b  ; with proper type tracking
     call %tmp.c()         ; use tracked type for method resolution
     ```
   - This preserves type information across the chain

## 🔀 Duplicate Code Paths — `generate()` vs `generateParts()` in llvm-generator.ts

**Root cause of missing tree-sitter declarations in Stage 1 IR**

`llvm-generator.ts` had two nearly identical methods:
- `generate()` — used by `compiler.ts` (the Node.js path), returns `string`
- `generateParts()` — used by `native-compiler-lib.ts` (the native path), returns `string[]`

These were 150+ line copy-pastes of each other. When tree-sitter auto-detection was added to `generate()`, it was never added to `generateParts()`. The result: Stage 0 (built via the Node.js path) worked fine, but the IR it produced for Stage 1 was missing `declare`/`define` statements for `@__ts_*` wrapper functions because Stage 0 used `generateParts()` internally.

**Fix**: Made `generate()` delegate to `generateParts().join('')`. One code path, no drift.

**Key rule**: When you find duplicate methods that do the same thing with different return types, consolidate immediately. The divergence WILL cause bugs — features added to one path silently break the other. This is especially dangerous in a self-hosting compiler where the compiler's own output is only as correct as its least-tested code path.

**How to detect**: Search for method pairs like `generateX()` / `generateXParts()` or `buildX()` / `buildXInner()` that have similar bodies. If they're >10 lines each, they should share code.

## ✅ Self-Hosting Verification is Non-Negotiable

Unit tests (240 of them) all passed while Stage 1 couldn't compile itself. The missing tree-sitter declarations only manifested when Stage 1 tried to produce Stage 2, because that's the only scenario where `generateParts()` is called on code that actually uses tree-sitter.

The verification chain must be: Stage 0 → Stage 1 → Stage 2 → smoke test. Anything less gives false confidence.

## 🐛 `new` in Class Field Initializers — Additional Instance

The pattern documented in "Three ChadScript Patterns That Crash Native Code" hit two more places:
- `SemanticAnalyzer.symbols: Map<string, TypedSymbol> = new Map()` → moved to constructor
- `ClosureAnalyzer.declaredVars: Set<string> = new Set()` → moved to constructor (the initializer had been removed but no constructor was added, causing a TypeScript compilation error)

**Lesson**: When removing a `new X()` field initializer for Stage 0 compatibility, you MUST either add a constructor that initializes the field, or initialize it in the first method that uses it. Just removing the initializer leaves the field uninitialized (TypeScript catches this, but it's easy to forget the constructor).



```bash
# Get backtrace from segfault
gdb -batch -ex "run examples/hello.ts" -ex "bt" ./.build/src/native-compiler

# View generated IR for a class method
grep -A30 "define.*@ClassName_methodName" .build/src/native-compiler.ll

# Compare struct layouts
grep -E "^%StructName" .build/src/native-compiler.ll

# Decode crash address to ASCII (often reveals which string field was accessed as pointer)
python3 -c "import struct; print(struct.pack('<Q', 0x746c75736572).decode('ascii', errors='replace'))"
```

## 📐 Struct-of-Arrays Pattern for Stage 0 Compatibility

Stage 0 (the self-hosted native compiler) cannot compile code that returns arrays of objects (e.g., `{ name: string; type: string }[]`). This is because Stage 0 loses type information when accessing fields on objects inside arrays — it treats them as opaque `i8*` pointers and segfaults when trying to access `.name` or `.type`.

**The fix:** Replace arrays-of-structs with struct-of-arrays. Instead of returning an array of objects where each element has named fields, return a single object containing parallel arrays.

### Before (crashes Stage 0):
```typescript
// Returns { name: string; type: string }[] — an array of objects
getInterfaceProperties(name: string): { name: string; type: string }[] | null {
  const properties: { name: string; type: string }[] = [];
  for (const field of iface.fields) {
    properties.push({ name: field.name, type: field.type });
  }
  return properties;
}

// Callers index into the array and access .name / .type on each element
for (let i = 0; i < props.length; i++) {
  keys.push(props[i].name);   // Stage 0 segfaults here
  types.push(props[i].type);
}
```

### After (Stage 0 compatible):
```typescript
// Returns { keys: string[]; types: string[] } — parallel arrays in one object
getInterfaceProperties(name: string): { keys: string[]; types: string[] } | null {
  const keys: string[] = [];
  const types: string[] = [];
  for (const field of iface.fields) {
    keys.push(field.name);
    types.push(field.type);
  }
  return { keys, types };
}

// Callers index the parallel arrays directly — no intermediate object access
for (let i = 0; i < props.keys.length; i++) {
  keys.push(props.keys[i]);     // simple array index, works in Stage 0
  types.push(props.types[i]);
}
```

### Why this works

The problem is `props[i].name` — a two-step chain: (1) index into an array to get an object, (2) access a field on that object. Stage 0 can handle `props.keys[i]` because `props.keys` is a known field on a typed object (which Stage 0 can resolve), and then `[i]` is a simple array index on a `string[]` (which Stage 0 handles natively).

### Key invariant

The parallel arrays must always have the same length: `result.keys.length === result.types.length`. This is enforced by tests in `tests/unit/interface-properties.test.ts`.

### Where this pattern is applied (commit 587eef57)

| Function | File | Old return type | New return type |
|---|---|---|---|
| `getInterfaceProperties` | `llvm-generator.ts` | `{ name: string; type: string }[]` | `{ keys: string[]; types: string[] }` |
| `getTypeAliasCommonProperties` | `llvm-generator.ts` | `{ name: string; type: string }[]` | `{ keys: string[]; types: string[] }` |
| `getBuiltinAstTypeFields` | `member.ts` | `{ name: string; type: string }[]` | `{ keys: string[]; types: string[]; tsTypes: string[] }` |
| `getMethodCallArrayReturn` | `variable-allocator.ts` | `{ elementType: string; fields: { name: string; type: string }[] }` | `string` (element type only) |

The same commit also applied related Stage 0 compatibility patterns:
- **Enum types widened to `number`**: `SymbolKind` enum parameters changed to `number` to avoid Stage 0 enum dispatch issues
- **String literal unions widened to `string`**: `'local' | 'global'` changed to `string` since Stage 0 cannot handle literal union types
- **Regex replaced with parsing functions**: `parseMapTypeString()`, `parseSetTypeString()`, `parseArrayTypeString()` in `type-system.ts` replace `.match()` regex calls that Stage 0 cannot compile
- **Method return values stored in locals**: `return this.symbolTable.isClass(name)` became `const result = this.symbolTable.isClass(name); return result;` to avoid Stage 0 losing type info on chained return expressions

## 🐛 Three ChadScript Patterns That Crash Native Code — Fixed

The native compiler (stage 0) has three language patterns that silently generate incorrect code. All three were discovered through iterative GDB debugging of segfaults in the arrow function codegen pipeline.

### 1. `new` in class field initializers is silently dropped

```typescript
// THIS CRASHES — field initializer is never executed in native code
class Foo {
  private analyzer: ClosureAnalyzer = new ClosureAnalyzer(); // stored as null
}

// FIX — create instances locally in methods instead
someMethod() {
  const analyzer = new ClosureAnalyzer(); // works fine
  analyzer.analyze(...);
}
```

**Why**: The parser captures field initializer expressions, but the native codegen only emits type-based defaults for class fields. Pointer-typed fields get `null`, numbers get `0.0`. The `new` expression is never executed. This is NOT a bug in the parser — it's a missing feature in codegen.

**How to detect**: Look for `store %SomeType* null` in the constructor IR for fields that should have been initialized with `new`.

### 2. Optional chaining (`?.`) compiles to direct access

```typescript
// THIS CRASHES — compiles to direct member access without null check
const x = obj?.field;       // → GEP on obj without checking null
const y = arr?.[i];          // → array index without checking null
const z = a?.b || fallback;  // → loads a.b, THEN evaluates ||

// FIX — use explicit null checks
const x = obj ? obj.field : undefined;
const y = arr ? arr[i] : undefined;
const z = a ? (a.b || fallback) : fallback;
```

**Why**: ChadScript's codegen doesn't implement the `?.` operator. The parser may parse it, but codegen treats it as regular `.` access. Any null value causes a segfault.

**How to detect**: Search source files for `?.` — every instance is a potential native crash.

### 3. Anonymous type assertions must match real struct field order AND count

```typescript
// THIS CRASHES — BinaryNode is { type, op, left, right } but cast skips 'op'
const e = expr as { type: string; left: Expression; right: Expression };
e.left;  // GEP index 1 → reads 'op' field instead of 'left'!

// FIX — include ALL fields in order, even if you don't use them
const e = expr as { type: string; op: string; left: Expression; right: Expression };
e.left;  // GEP index 2 → correctly reads 'left'

// ALSO CRASHES — InterfaceDeclaration is { name, extends, fields, methods }
const i = x as { name: string; fields: InterfaceField[] };
i.fields;  // GEP index 1 → reads 'extends' instead of 'fields'!

// FIX
const i = x as { name: string; extends: string[]; fields: InterfaceField[] };
i.fields;  // GEP index 2 → correct
```

**Why**: ChadScript uses GEP (getelementptr) with field indices based on the anonymous type's field order. If you cast `{ type, left, right }` when the real struct is `{ type, op, left, right }`, then `left` is at GEP index 1 in your cast but GEP index 2 in the real struct. The codegen uses your cast's index, reading the wrong field.

**Key rule**: When using `as { ... }` type assertions, the fields listed must be a PREFIX of the real struct's fields in the EXACT same order. You can omit trailing fields you don't access, but you cannot skip fields in the middle.

**How to detect**: For every `as { field1, field2, ... }` cast, look up the actual AST type definition in `src/ast/types.ts` and verify the field order matches. Common culprits:
- `BinaryNode`: has `op` between `type` and `left`
- `UnaryNode`: has `op` between `type` and `operand`
- `InterfaceDeclaration`: has `extends` between `name` and `fields`
- `MethodCallNode`: has `method` between `object` and `args`
- `ForOfStatement`: has `variableKind`, `variableName`, `destructuredNames` before `iterable`
- `FunctionParameter`: has 4 fields `{ name, type, optional, defaultValue }`

### Debugging methodology

The general approach for native compiler segfaults:

1. **Generate IR**: `chad build source.ts -o out --emit-llvm` then examine `out.ll`
2. **GDB**: `gdb -batch -ex "run args" -ex "bt" -ex "info registers" ./binary`
3. **Find the crash**: The backtrace gives the function name + offset. Search for `define.*@FunctionName` in the `.ll` file
4. **Identify the bad instruction**: `x/3i $rip` in GDB shows the faulting instruction. `rax=0` + `mov (%rax), %rax` = null pointer dereference
5. **Trace back to source**: The GEP index tells you which field was accessed. Count the fields in the source-level type cast to find the mismatch

## 🐛 Boolean Field Type Mismatch (i1 vs double) — Fixed

**Root cause of Stage 1 → Stage 2 segfault in `isStringArrayExpression`**

Interface structs store boolean fields as `double` (via `tsTypeToLlvm` in `type-system.ts`), but multiple codegen locations were emitting `load i1` / `store i1` for boolean fields on interface structs. This is correct for class structs (which use `i1` via `fieldToLlvmType` in `class.ts`), but wrong for interfaces.

**Why it's silent and catastrophic**: `load i1` from IEEE 754 `double 1.0` (`0x3FF0000000000000` little-endian) reads the first byte `0x00` = false. So `isPointerAlloca` (a boolean field on the Symbol interface) always returned false in native code, causing `handleSimpleAssignment` to write 16-byte array structs into 8-byte pointer allocas, corrupting adjacent stack memory.

**Files fixed**: `member.ts` (3 locations: `handleTypedJsonStructAccess`, `loadFieldValue`, `handleChainedInterfaceAccess`), `json.ts` (struct definition + parser), `response.ts` (error path + parse path).

**Key rule**: Class structs → boolean is `i1`. Interface structs → boolean is `double`. The `assignment-generator.ts` and `class.ts` `store i1` are correct because they only handle class fields.

