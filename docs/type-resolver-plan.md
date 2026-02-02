# TypeResolver Implementation Plan

## Problem
Type inference is scattered across 30+ methods in 4+ files with significant duplication.

## TypeResolver Class Design

```typescript
// src/codegen/infrastructure/type-resolver/type-resolver.ts

export interface TypeResolverContext {
  ast: AST;
  symbolTable: SymbolTable;
  typeChecker?: TypeChecker | null;
  currentClassName?: string | null;
  currentFunction?: string | null;
}

export class TypeResolver {
  constructor(private ctx: TypeResolverContext) {}

  // Interface resolution (consolidates 10+ duplicates of ast.interfaces.find)
  getInterface(name: string): InterfaceDeclaration | null;
  getInterfaceMetadata(name: string): ObjectMetadata | null;
  getTypeAlias(name: string): TypeAliasDeclaration | null;
  getUnionCommonFields(memberNames: string[]): ObjectMetadata;

  // TS to LLVM conversion (consolidates 5 duplicates)
  tsTypeToLlvm(tsType: string): string;
  tsTypeToLlvmJson(tsType: string): string;

  // Class field resolution with inheritance
  getClassFieldInfo(className: string, fieldName: string): FieldInfo | null;
  getClassFieldMapType(className: string, fieldName: string): MapTypeInfo | null;
  getClassFieldSetType(className: string, fieldName: string): SetTypeInfo | null;

  // Expression type resolution
  resolveIndexedAccessType(expr: IndexAccessNode): ObjectMetadata | null;
  resolveMemberAccessType(expr: MemberAccessNode): TypeResolution | null;
  getMapGetInterfaceType(expr: Expression): string | null;

  // Type guards
  detectTypeGuard(condition: Expression): TypeGuardInfo | null;
  findInterfaceByDiscriminant(value: string, field?: string): string | null;

  // Utilities
  areTypesCompatible(type1: string, type2: string): boolean;
  normalizeType(typeStr: string): string;
}
```

## Migration Mapping

| Current Method | Current File | TypeResolver Method |
|----------------|--------------|---------------------|
| `getMapGetInterfaceType()` | variable-allocator | `getMapGetInterfaceType()` |
| `getIndexedObjectArrayType()` | variable-allocator | `resolveIndexedAccessType()` |
| `getUnionCommonFields()` | variable-allocator | `getUnionCommonFields()` |
| `tsTypeToLlvm()` | 5 files | `tsTypeToLlvm()` |
| `getThisFieldMapType()` | method-calls | `getClassFieldMapType()` |
| `getThisFieldSetType()` | method-calls | `getClassFieldSetType()` |
| `detectTypeGuard()` | control-flow | `detectTypeGuard()` |
| `getObjectArrayInfo()` | control-flow | `getObjectArrayElementType()` |
| `findInterfaceByDiscriminant()` | control-flow | `findInterfaceByDiscriminant()` |

## File Structure

```
src/codegen/infrastructure/type-resolver/
├── index.ts           # Re-exports (~30 lines)
├── type-resolver.ts   # Main class (~400 lines)
└── types.ts           # Shared types (~50 lines)
```

## Migration Strategy

1. Create TypeResolver with core methods
2. Add to IGeneratorContext as optional field
3. Migrate one file at a time, running tests after each
4. Keep backward-compatible wrappers initially
5. Remove deprecated methods after all callers migrated
