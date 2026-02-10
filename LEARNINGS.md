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

## 🔧 Common Debugging Patterns

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

## 🐛 Boolean Field Type Mismatch (i1 vs double) — Fixed

**Root cause of Stage 1 → Stage 2 segfault in `isStringArrayExpression`**

Interface structs store boolean fields as `double` (via `tsTypeToLlvm` in `type-system.ts`), but multiple codegen locations were emitting `load i1` / `store i1` for boolean fields on interface structs. This is correct for class structs (which use `i1` via `fieldToLlvmType` in `class.ts`), but wrong for interfaces.

**Why it's silent and catastrophic**: `load i1` from IEEE 754 `double 1.0` (`0x3FF0000000000000` little-endian) reads the first byte `0x00` = false. So `isPointerAlloca` (a boolean field on the Symbol interface) always returned false in native code, causing `handleSimpleAssignment` to write 16-byte array structs into 8-byte pointer allocas, corrupting adjacent stack memory.

**Files fixed**: `member.ts` (3 locations: `handleTypedJsonStructAccess`, `loadFieldValue`, `handleChainedInterfaceAccess`), `json.ts` (struct definition + parser), `response.ts` (error path + parse path).

**Key rule**: Class structs → boolean is `i1`. Interface structs → boolean is `double`. The `assignment-generator.ts` and `class.ts` `store i1` are correct because they only handle class fields.

