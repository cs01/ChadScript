# Generics

Generic functions and classes compile **once** per declaration. Each type parameter becomes one
self-describing word (a number, string, boolean, `null`, `undefined` or object reference), or its
constraint's representation when it has one (`T extends HasId` reads `x.id` like any object).
Calls convert values at the boundary between the declaration's erased signature and tsc's
resolved one.

<<< @/examples/generics.ts

<<< @/examples/generics.out{text}

## Limits today

- A type argument that does not fit in one word, such as an array, a `Map` or a function, is
  rejected ([CS1242](/reference/errors#cs1242)): `firstOr<number[]>(...)` fails. Wrap it in an
  object (`{ items: xs }`) or write a non-generic function. Specialization
  (monomorphization) is planned as an optimization.
- Type-level computation (conditional, mapped and indexed-access types, `keyof`) is rejected
  ([CS1243](/reference/errors#cs1243)); write the resulting type out.
- Generic code cannot construct its type parameter (`new () => T`,
  [CS1244](/reference/errors#cs1244)); pass a factory function.
