# RFC: Proper Interface Dispatch for ChadScript

## Status: Draft

## Problem Statement

ChadScript treats TypeScript interfaces as concrete LLVM struct types with their own
memory layout. When a class instance is stored in an interface-typed variable and methods
are called on it, the struct layouts don't match -- leading to field access at wrong
offsets and crashes.

The current workaround is "wrapper methods": instead of `ctx.classGen.getFieldInfo()`,
the codebase uses `ctx.classGenGetFieldInfo()`, which avoids chained member access on
interface-typed variables. This has led to ~200 wrapper methods in `generator-context.ts`
and grows O(n*m) with every new method or sub-generator.

### Core Issue

```
interface IFoo { a: string; b: number; }
class Foo implements IFoo { b: number; a: string; x: boolean; }

// TypeScript: fine, IFoo is a compile-time contract
// ChadScript LLVM:
//   %IFoo = type { i8*, double }        <- interface layout: [a, b]
//   %Foo_struct = type { double, i8*, i1 } <- class layout: [b, a, x]
//
// When code does: let f: IFoo = new Foo(); f.a;
//   Compiled as: getelementptr %IFoo, ptr, 0, 0  -> reads field 0 (which is `b` in memory!)
```

The interface struct occupies *different memory* than the class struct. Storing a Foo*
into an IFoo-typed variable either truncates the pointer to interface-sized memory or
bitcasts it -- both are wrong because field indices differ.

## Approaches Evaluated

### Approach 1: VTable-Based Dispatch (C++/Java style)

Every interface-typed variable stores a fat pointer: `{ vtable_ptr, data_ptr }`.
Method calls go through the vtable. Field access goes through accessor methods in the
vtable.

```llvm
%IFoo_vtable = type { i8* (i8*)*, double (i8*)* }  ; getA, getB
%IFoo_ref = type { %IFoo_vtable*, i8* }            ; vtable + data pointer

; Calling method:
%vtable = load %IFoo_vtable*, %IFoo_ref.vtable
%method_ptr = getelementptr %IFoo_vtable, %vtable, 0, 0  ; slot for getA
%fn = load i8* (i8*)*, %method_ptr
%result = call i8* %fn(i8* %data_ptr)
```

**Pros:**
- True runtime polymorphism (multiple classes can implement same interface)
- Standard, well-understood pattern
- Clean separation of concerns

**Cons:**
- Requires function pointers, which ChadScript doesn't currently support in LLVM codegen
- Every field access becomes a virtual call (performance)
- Significant change to how interface values are represented (2-word fat pointer)
- Stage 0 bootstrap: ChadScript compiling itself needs to handle vtable creation/lookup
  through the compiler it's compiling with (itself) -- chicken-and-egg complexity
- Interface field access becomes method calls, changing the call convention entirely

**Verdict: Too complex for current stage. Ideal long-term but wrong next step.**

### Approach 2: Concrete Type Registry (compile-time resolution)

At compile time, track which concrete class is behind every interface-typed variable.
When accessing fields or calling methods on an interface-typed variable, always resolve
to the concrete class's layout.

This is essentially what `findClassImplementingInterface()` already does, but applied
consistently at every access site instead of ad-hoc.

```typescript
// When we see:  let ctx: IGeneratorContext = new LLVMGenerator();
// Symbol table records: ctx -> { interfaceType: "IGeneratorContext", concreteClass: "LLVMGenerator" }
//
// When we see:  ctx.symbolTable
// Instead of:   getelementptr %IGeneratorContext, ptr, 0, <interfaceFieldIndex>
// We emit:      getelementptr %LLVMGenerator_struct, ptr, 0, <classFieldIndex>
```

**Pros:**
- Builds on existing `findClassImplementingInterface()` pattern
- Zero runtime overhead (all resolution is compile-time)
- Minimal changes to existing codegen
- No new LLVM constructs needed (no function pointers, no vtables)

**Cons:**
- Only works when concrete type is known at compile time
- Doesn't support true polymorphism (different concrete types at same call site)
- Must propagate concrete type through assignments, function params, returns

**Verdict: This is the right incremental step. Fix the root cause of the wrapper method
problem without requiring new runtime primitives.**

### Approach 3: ABI-Aligned Interface Structs

Make interface structs match class struct layout. When a class implements an interface,
the interface struct is generated to match the class's field order and include all class
fields (not just interface fields).

```llvm
; Instead of:
%IFoo = type { i8*, double }        ; interface's own layout
; Generate:
%IFoo = type { double, i8*, i1 }    ; matches Foo_struct layout exactly
```

**Pros:**
- Bitcasting between interface and class pointers is always safe
- Simple conceptual model

**Cons:**
- Breaks down with multiple implementors (which class layout to use?)
- Interface struct definition depends on classes, creating circular dependency
- Interface-typed fields in other structs would need to change size dynamically
- Doesn't generalize at all

**Verdict: Too fragile, doesn't scale.**

### Approach 4: Eliminate Interface Structs Entirely

Don't generate `%InterfaceName = type { ... }` at all. Interface-typed variables always
store `i8*` (opaque pointer to the concrete class). All access goes through the concrete
class's struct type after resolving the concrete type.

```llvm
; No %IFoo type defined at all
; Variable `f: IFoo = new Foo()` stored as:
%f = alloca i8*
%foo = call i8* @Foo_new()
store i8* %foo, i8** %f

; Access f.a:
%ptr = load i8*, i8** %f
%typed = bitcast i8* %ptr to %Foo_struct*
%a_ptr = getelementptr %Foo_struct, %Foo_struct* %typed, i32 0, i32 1  ; Foo's index for 'a'
%a = load i8*, i8** %a_ptr
```

**Pros:**
- Eliminates the struct layout mismatch entirely -- there is no interface struct
- Simplifies the codegen (no interface struct definitions to maintain)
- All field access always uses the correct class layout
- Natural fit with existing `findClassImplementingInterface()` pattern

**Cons:**
- Must always know concrete type (same limitation as Approach 2)
- Loses the ability to use interface struct types for parameter passing
- Requires updating all code that currently generates `%InterfaceName` types

**Verdict: Variant of Approach 2. Worth considering as end-state but more disruptive.**

## Recommended Design: Enhanced Concrete Type Registry (Approach 2)

### Overview

Systematically fix the compile-time concrete type tracking so that **every** interface-typed
variable has its concrete class recorded in the symbol table. Then modify member access
and method call codegen to **always** use the concrete class layout instead of the interface
layout.

This eliminates the need for wrapper methods because chained access like `ctx.classGen.method()`
will work correctly: `ctx` resolves to `LLVMGenerator`, `.classGen` resolves to
`ClassGenerator` (via field type lookup on `LLVMGenerator`), and `.method()` dispatches
on `ClassGenerator`.

### Key Insight

The wrapper method pattern exists because chained member access `a.b.c()` loses type
information at the intermediate step. When `a` is interface-typed, accessing `a.b` uses
the interface struct's field index (wrong!), producing garbage. The fix is:

1. `a` is interface-typed -> resolve to concrete class `ConcreteA`
2. Access `.b` using `ConcreteA`'s field index -> get correct pointer + type info
3. Record that the result of `a.b` has concrete type `ConcreteB`
4. Dispatch `.c()` on `ConcreteB`

The type information must flow through the chain.

### Design Components

#### Component 1: ConcreteTypeMap in Symbol Table

Add a map from variable name to concrete class name in the symbol table:

```typescript
// In symbol-table.ts
interface SymbolEntry {
  // ... existing fields ...
  concreteClass?: string;  // The actual class behind an interface-typed variable
}
```

**Population rules:**
- `let x: IFoo = new Foo()` -> concreteClass = "Foo"
- `let x: IFoo = someFunc()` where someFunc returns IFoo -> look up return type resolution
- `function f(x: IFoo)` -> resolve at call site, propagate concrete type
- `let x = y` where y has concreteClass -> x inherits concreteClass

#### Component 2: Concrete Type Propagation in Member Access

Modify `member.ts` to propagate concrete type through chained access:

```typescript
// When handling a.b where a has concreteClass "ConcreteA":
// 1. Get field info from ConcreteA (not from interface)
// 2. Determine the type of field b
// 3. If b's type is also an interface, resolve its concrete class
// 4. Store the result temp with its concrete type info
```

Key method to modify: `handleObjectPropertyAccess()` and `handleChainedInterfaceAccess()`

Currently these methods do find the implementing class, but they don't propagate the
concrete type to the *result*. The result gets stored as `i8*` without tracking what
concrete class it points to.

#### Component 3: Method Call Resolution Using Concrete Type

Modify `method-calls.ts` to use concrete type from symbol table:

```typescript
// When handling a.method() where a has concreteClass:
// Use concreteClass directly instead of searching all classes
```

This mostly works already via `findClassImplementingInterfaceMethod()`, but the
enhancement is to make it use the symbol table's concrete type first (O(1) lookup)
instead of scanning all classes (O(n) search).

#### Component 4: Chained Access Type Flow

The hardest part. For `a.b.c()`:

```
Expression tree:
  MethodCall {
    object: MemberAccess {
      object: MemberAccess {
        object: Variable "a"
        property: "b"
      }
      property: "c"    // wait, c() is a method, not property
    }
    method: "c"
  }
```

Actually in practice the AST for `a.b.c()` is:
```
MethodCall {
  object: MemberAccess { object: Variable("a"), property: "b" }
  method: "c",
  args: []
}
```

The fix: when generating the expression for `MemberAccess { a, "b" }`:
1. Resolve `a` to its concrete class
2. Look up field `b` on that concrete class
3. Get `b`'s type (e.g., `ClassGenerator`)
4. Tag the result temp with `concreteClass = "ClassGenerator"`
5. When `MethodCall` uses this result as its object, it can dispatch on `ClassGenerator`

### Implementation Plan

#### Phase 1: Symbol Table Enhancement (foundation)

Add `concreteClass` tracking to the symbol table. Populate it at:
- Variable declarations with `new` on the RHS
- Variable declarations with interface type annotation + class assignment
- Function parameter passing (at call sites)

This is backward-compatible -- existing code doesn't use `concreteClass` yet.

#### Phase 2: Member Access Uses Concrete Type (fixes field access)

Modify `handleObjectPropertyAccess()` to:
1. Check `concreteClass` first (O(1)) before `findClassImplementingInterface()` (O(n))
2. When accessing a field whose type resolves to a class, set `concreteClass` on the
   result temp

This fixes `ctx.fieldName` when ctx is interface-typed.

#### Phase 3: Method Calls Use Concrete Type (fixes method dispatch)

Modify `handleClassMethods()` to:
1. Check `concreteClass` on the object first
2. Use it directly for method resolution

This fixes `ctx.method()` when ctx is interface-typed.

#### Phase 4: Chained Access (fixes `a.b.c()`)

Modify member access result tracking so intermediate values carry concrete type info.
This allows `ctx.classGen.getFieldInfo()` to work without wrapper methods.

This is the phase that actually *eliminates* the need for wrapper methods.

#### Phase 5: Remove Wrapper Methods (cleanup)

Once chained access works, gradually remove wrapper methods from `generator-context.ts`
and use direct chained access instead. This should be done incrementally, one
sub-generator at a time, with testing after each removal.

### Stage 0 Bootstrap Compatibility

This design is Stage 0 compatible because:
1. No new LLVM constructs (no function pointers, no vtables)
2. No new runtime data structures
3. All changes are in the compile-time type tracking
4. Existing bitcast + getelementptr pattern is preserved
5. The only change is using the *correct* struct type for getelementptr

The concrete type registry is purely compile-time bookkeeping. The generated LLVM IR
uses the same instructions, just with correct type indices.

### Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Concrete type not always known | Fall back to existing `findClassImplementingInterface()` |
| Function params lose concrete type | Propagate at call site; fall back to first implementor |
| Multiple classes implement same interface | First-match semantics (same as current behavior) |
| Breaks Stage 0 | Changes are in TypeScript codegen only, not in generated IR patterns |
| Chained access too complex | Implement incrementally; each phase independently useful |

### Success Criteria

1. `ctx.classGen.getFieldInfo()` works without wrapper method
2. `ctx.symbolTable.isClass()` works without wrapper method
3. At least one sub-generator's wrapper methods can be removed
4. All existing tests pass
5. Stage 0 bootstrap still works

### Non-Goals

- True runtime polymorphism (vtable dispatch) -- deferred to future RFC
- Supporting `interface I = A | B` union dispatch -- not needed yet
- Removing ALL wrapper methods at once -- incremental removal is safer

## Prototype Scope

The prototype will implement:
1. `concreteClass` field in symbol table entries
2. Population from `new` expressions assigned to interface-typed variables
3. One example of chained access working: `ctx.classGen.getFieldInfo()` path
4. Verification that existing tests still pass

The prototype will NOT implement:
- Full concrete type propagation through all code paths
- Wrapper method removal (that's the follow-up work)
- Function parameter concrete type propagation
