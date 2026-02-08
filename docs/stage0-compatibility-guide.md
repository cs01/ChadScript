# Stage 0 Compatibility Guide

ChadScript is a self-hosting TypeScript-to-LLVM compiler. "Stage 0" is the native LLVM-compiled version of the compiler itself. Because the compiler must be able to compile its own source code, there are strict constraints on what TypeScript patterns can appear in the codebase.

This guide documents the patterns that Stage 0 cannot handle and the workarounds used.

## Quick Reference: What Stage 0 Can't Do

| Pattern | Why it fails | Workaround |
|---|---|---|
| `arr[i].field` | Loses type info on array element | Struct-of-arrays |
| `a.b.method()` | Loses type info on intermediate `a.b` | Wrapper methods (legacy) / concrete type registry (WIP) |
| `.match()` / regex | No regex runtime support | Manual character-by-character parsing |
| `enum Foo` as param type | Can't dispatch on enum types | Widen to `number` |
| `'a' \| 'b'` as param type | Can't dispatch on literal unions | Widen to `string` |
| `return obj.method()` | Loses type info on chained return | Store in local variable first |

## Pattern 1: Struct-of-Arrays

### The problem

Stage 0 cannot access fields on objects inside arrays. The expression `props[i].name` is a two-step chain:

1. Index into array to get an object — produces `i8*` (type info lost)
2. Access `.name` on that object — Stage 0 doesn't know the struct layout, segfaults

### The fix

Replace array-of-structs with struct-of-arrays. Return a single object containing parallel arrays instead of an array of objects.

**Before (crashes Stage 0):**
```typescript
getInterfaceProperties(name: string): { name: string; type: string }[] | null {
  const properties: { name: string; type: string }[] = [];
  for (const field of iface.fields) {
    properties.push({ name: field.name, type: field.type });
  }
  return properties;
}

for (let i = 0; i < props.length; i++) {
  keys.push(props[i].name);   // segfault — i8* has no known struct layout
  types.push(props[i].type);
}
```

**After (Stage 0 compatible):**
```typescript
getInterfaceProperties(name: string): { keys: string[]; types: string[] } | null {
  const keys: string[] = [];
  const types: string[] = [];
  for (const field of iface.fields) {
    keys.push(field.name);
    types.push(field.type);
  }
  return { keys, types };
}

for (let i = 0; i < props.keys.length; i++) {
  keys.push(props.keys[i]);     // field access on typed object + simple array index
  types.push(props.types[i]);
}
```

### Why it works

`props.keys[i]` decomposes differently than `props[i].name`:

- `props.keys` — field access on a known typed object (Stage 0 can resolve the struct layout)
- `[i]` — simple array index on `string[]` (Stage 0 handles natively)

No intermediate opaque pointer is created.

### Key invariant

The parallel arrays must always have the same length: `result.keys.length === result.types.length`. This is enforced by tests in `tests/unit/interface-properties.test.ts`.

### Where this is used

| Function | File |
|---|---|
| `getInterfaceProperties()` | `src/codegen/llvm-generator.ts` |
| `getTypeAliasCommonProperties()` | `src/codegen/llvm-generator.ts` |
| `getInterfaceMetadata()` | `src/codegen/infrastructure/type-resolver/type-resolver.ts` |
| `getUnionCommonFields()` | `src/codegen/infrastructure/type-resolver/type-resolver.ts` |

The return type used throughout the codebase is `ObjectMetadata`:

```typescript
// src/codegen/infrastructure/symbol-table.ts
interface ObjectMetadata {
  keys: string[];
  types: string[];
  tsTypes?: string[];
}
```

## Pattern 2: Type Widening

Stage 0 maps all non-primitive types to opaque pointers (`i8*`) at the LLVM level. This is called "type widening."

### Core widening rules

Defined in `tsTypeToLlvm()` in `src/codegen/infrastructure/type-system.ts`:

| TypeScript type | LLVM type | Notes |
|---|---|---|
| `string` | `i8*` | Pointer to string data |
| `number` | `double` | 64-bit float |
| `boolean` | `double` | Stored as 0.0 or 1.0 |
| Any class/interface | `i8*` | Opaque pointer |
| `SymbolKind` (enum) | `number` | Stage 0 can't dispatch enums |
| `'a' \| 'b'` (literal union) | `string` | Stage 0 can't dispatch literal unions |
| `string[]` | `%StringArray*` | Special array struct |
| `number[]` | `%Array*` | Special array struct |
| `T[]` (custom type) | `%ObjectArray*` | Special array struct |

### Enum widening

Stage 0 cannot dispatch on enum types. All enum-typed parameters must be widened to `number`:

```typescript
// Before:
defineVariable(name: string, allocaReg: string, llvmType: string, kind: SymbolKind): void;

// After:
defineVariable(name: string, allocaReg: string, llvmType: string, kind: number): void;
```

### String literal union widening

Stage 0 cannot handle literal union types. Widen to `string`:

```typescript
// Before:
scope: 'local' | 'global'

// After:
scope: string
```

### Concrete type tracking

When everything becomes `i8*`, the compiler needs a separate mechanism to know what's actually behind the pointer. This is tracked in two places:

1. **Symbol table** — `concreteClass` field records which class a variable actually holds
2. **`actualClassTypes` map** — in `BaseGenerator`, maps temp registers to their concrete class names

Example: when `let ctx: IGeneratorContext = new LLVMGenerator()` is compiled, the symbol table records `ctx → concreteClass: "LLVMGenerator"`. Later, when `ctx.method()` is compiled, the codegen looks up the concrete class and uses `LLVMGenerator`'s struct layout for the method dispatch.

## Pattern 3: Manual Parsing (No Regex)

Stage 0 cannot compile `.match()` or any regex operations. All type-string parsing uses hand-written character-by-character logic.

### Type string parsers

All located in `src/codegen/infrastructure/type-system.ts`:

| Function | Purpose | Example input |
|---|---|---|
| `parseTypeString()` | Main type annotation parser | `"Map<string, number>[]?"` |
| `parseGenericParams()` | Extract generic type parameters | `"Map<string, Array<number>>"` |
| `parseMapTypeString()` | Parse `Map<K, V>` | `"Map<string, number>"` |
| `parseSetTypeString()` | Parse `Set<T>` | `"Set<string>"` |
| `parseArrayTypeString()` | Parse `T[]` | `"string[]"` |

### Parsing technique

Instead of regex, scan character-by-character tracking bracket depth:

```typescript
function parseMapTypeString(s: string): { keyType: string; valueType: string } | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed.startsWith('Map<')) return null;
  if (!trimmed.endsWith('>')) return null;

  const inner = trimmed.substring(4, trimmed.length - 1);
  let depth = 0;
  let commaIdx = -1;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '<') { depth = depth + 1; }
    else if (ch === '>') { depth = depth - 1; }
    else if (ch === ',' && depth === 0) {
      commaIdx = i;
      break;
    }
  }

  if (commaIdx === -1) return null;
  const keyType = inner.substring(0, commaIdx).trim();
  const valueType = inner.substring(commaIdx + 1).trim();
  if (!keyType || !valueType) return null;
  return { keyType, valueType };
}
```

The depth-tracking pattern (incrementing on `<`/`[`, decrementing on `>`/`]`, only splitting at depth 0) is reused across all parsers.

### AST transformer

The entire AST transformer (`src/parser-native/transformer.ts`, ~2254 lines) uses zero regex. It walks tree-sitter nodes and manually:

- Extracts string escape sequences character-by-character
- Identifies operators by scanning child nodes
- Lowers `switch` statements into nested if-else chains (LLVM has no switch)

## Pattern 4: Wrapper Methods (Legacy — Do Not Extend)

### The problem

When Stage 0 encounters chained member access like `ctx.symbolTable.isClass(name)`:

1. `ctx` is loaded — it's interface-typed, stored as `i8*`
2. `.symbolTable` accesses a field — produces another `i8*`, type info lost
3. `.isClass()` tries to call a method on an opaque pointer — segfault

### The workaround

Flatten chained access into a single method call on the concrete class:

```typescript
// Instead of:
ctx.symbolTable.isClass(name)

// Use:
ctx.symbolTableIsClass(name)
```

This works because `symbolTableIsClass()` is defined directly on the concrete class, so Stage 0 can resolve the struct layout.

### Why you must NOT add more

The `IGeneratorContext` interface in `src/codegen/infrastructure/generator-context.ts` already has ~195 wrapper methods across 14 categories (symbolTable, classGen, typeResolver, stringGen, etc.). Every new method on a sub-generator requires a wrapper in the interface, the implementation, and the mock — O(n*m) growth.

### The proper fix

The Concrete Type Registry (documented in `docs/design/interface-dispatch-rfc.md`) will make chained access work by tracking concrete types through intermediate values. Once implemented, wrapper methods can be removed incrementally.

If Stage 0 crashes on chained access:

1. Investigate the root cause in `member.ts` / `method-calls.ts`
2. Fix the type tracking for intermediate pointer values
3. Store concrete type information alongside `i8*` pointers
4. See LEARNINGS.md "Interface Method Dispatch Struct Layout Mismatch"

## Pattern 5: Return Values Stored in Locals

### The problem

Stage 0 loses type information on chained return expressions:

```typescript
// Crashes Stage 0:
symbolTableIsClass(name: string): boolean {
  return this.symbolTable.isClass(name);
}
```

### The fix

Store the result in a local variable before returning:

```typescript
symbolTableIsClass(name: string): boolean {
  const result = this.symbolTable.isClass(name);
  return result;
}
```

The local variable gives Stage 0 a named alloca to track the type through.

## Debugging Stage 0 Crashes

```bash
# Get backtrace from segfault
gdb -batch -ex "run examples/hello.ts" -ex "bt" ./.build/src/native-compiler

# View generated IR for a class method
grep -A30 "define.*@ClassName_methodName" .build/src/native-compiler.ll

# Compare struct layouts
grep -E "^%StructName" .build/src/native-compiler.ll

# Decode crash address to ASCII (reveals which string field was accessed as pointer)
python3 -c "import struct; print(struct.pack('<Q', 0x746c75736572).decode('ascii', errors='replace'))"
```

## Further Reading

- `LEARNINGS.md` — DO/DON'T patterns, critical interface dispatch details
- `docs/design/interface-dispatch-rfc.md` — RFC for the concrete type registry that will replace wrapper methods
- `.llms/rules/rules.md` — Project rules including the "stop adding wrapper methods" directive
