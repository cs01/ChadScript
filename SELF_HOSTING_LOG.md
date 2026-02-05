# Self-Hosting Progress Log

This file contains detailed notes on fixes and progress toward self-hosting.

## Current Status

**Phase:** 3 - Self-Hosting Bootstrap
**Progress:** Stage 1 compiles AND runs hello.ts and programs with user-defined functions! simple-add.js works (returns 12). Stage 1 can now parse many source files (passes type-only import check). Enum types are now supported as numeric values.

## Fixes Applied (2026-02-04)

### Enum Types Now Use Numeric Values
- **Problem:** `EnumMember.value` was typed as `number | string`, which ChadScript can't handle
- **Fix:** Changed `EnumMember.value` to just `number`, convert string enums to auto-incremented numeric values
- **Files:** `src/ast/types.ts`, `src/parser-ts/handlers/declarations.ts`, various codegen files

### Type-Only Imports Blocking Self-Hosting
- **Problem:** Stage 1 failed with "Cannot compile npm package: typescript"
- **Fix:** Added detection in `transformImportStatement` to check if import text starts with `import type ` and return null
- **Files:** `src/parser-native/transformer.ts`

### Interface extends Field Not Initialized
- **Problem:** Stage 1 crashed with segfault when accessing `iface.extends` on interfaces
- **Fix:** Parse `extends_type_clause` nodes, always return `extends: extendsArr` (empty array if no parents)
- **Files:** `src/parser-native/transformer.ts`

### Empty String Return Type Treated as Object Type
- **Problem:** Stage 1 generated `i8*` return type for functions without explicit type annotations
- **Fix:** Added explicit check for empty string: `theReturnType !== ''`
- **Files:** `src/codegen/infrastructure/function-generator.ts`, `src/codegen/expressions/calls.ts`

### Optional Chaining Null Pointer Crash
- **Problem:** Stage 1 crashed with segfault in `CallExpressionGenerator_generateGenericCall`
- **Fix:** Replaced `func?.params?.length` with explicit null checks
- **Note:** ChadScript doesn't yet implement optional chaining codegen. All `?.` usage needs explicit null checks.

### Interface Struct Layout Mismatch
- **Problem:** Accessing `ctx.globalStrings` through interface type used wrong field offset
- **Fix:** Reordered member access resolution to try `findClassImplementingInterface()` BEFORE `interfaceStructGen.hasInterface()`

### Void Functions Emitting `unreachable`
- **Problem:** Stage 1 hung in infinite loop
- **Fix:** Removed special case that emitted `unreachable` instead of `ret void`

### Pointer Precision for Tree-Sitter
- **Problem:** `nodePtr: number` was stored as `double`, losing 64-bit pointer precision
- **Fix:** Store `nodePtr`/`treePtr` fields as `i8*` instead of `double`

### Dynamic Alloca in Non-Entry Blocks
- **Problem:** Stack corruption causing segfaults
- **Fix:** Modified `base-generator.ts:emit()` to detect named alloca instructions and defer to entry block

## Known Issues

### Interface Struct Layout Mismatch (Partial)
When a class field has an interface type but holds a class instance, property access uses the WRONG field offsets.

**Example:**
- `IGeneratorContext` has `globalStrings` at index 1
- `LLVMGenerator_struct` has `globalStrings` at index 7
- When accessing through interface, it uses index 1, but actual object has it at index 7

### Array Field Initialization
Class fields with array initializers like `private x: T[] = [];` are initialized to `null` instead of empty array.

## Debug Tips

```bash
# Get backtrace from segfault
gdb -batch -ex "run examples/hello.ts" -ex "bt" ./.build/src/native-compiler

# View generated LLVM IR for a specific class
grep -A30 "define.*@ClassName_methodName" .build/src/native-compiler.ll

# Compare struct layouts
grep -E "^%LLVMGenerator_struct|^%MethodCallGeneratorContext" .build/src/native-compiler.ll

# Build native compiler
npx tsx src/index.ts --use-ts-parser --link-tree-sitter src/native-compiler.ts

# Test Stage 1
./.build/src/native-compiler examples/hello.ts
./.build/src/native-compiler --use-ts-parser src/native-compiler.ts
```

## Bootstrap Milestones

- [x] Stage 0→1: Compile native-compiler.ts to Stage 1 binary
- [x] Constructor parameter properties work
- [x] Interface method dispatch finds correct implementing class
- [x] Interface method calls bitcast to correct struct type
- [x] Object array fields typed as %Array* instead of i8*
- [x] Stage 1 runs without crashing (for simple examples)
- [x] Stage 1 compiles hello.ts example correctly
- [x] Stage 1 compiles examples WITH user-defined functions
- [ ] Array field initializers (= []) work correctly
- [ ] Stage 1 compiles ALL smoke tests
- [ ] Stage 1→2: Stage 1 compiles itself
- [ ] Stage 2 output matches Stage 1 (bootstrap verified!)
