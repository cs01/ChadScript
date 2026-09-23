# Value model

How a TypeScript value is laid out in the binary, and why. The short version: representation
belongs to the value, not only to the static type, because TypeScript is structural and a
`{ y, x }` object can be passed where `{ x }` is expected.

Representation belongs to the value, not only to the static type, because TypeScript is
structural: a `{ y, x }` object can be passed where `{ x }` is expected.

- **Primitives are unboxed.** `number` is a `double`, `boolean` an `i1`, `string` a UTF-8
  `{ptr, len}` pair.
- **Shaped objects.** Every object starts with a pointer to an immutable runtime shape: field
  names to slots, method names to functions, class name, and per-shape print and JSON functions.
  Class instances and object literals share this model. Shapes never change after allocation,
  because the subset forbids adding and deleting properties.
- **Static slots where possible, inline caches otherwise.** The program is compiled whole, so for
  each static type the compiler knows every allocation layout that can reach it. If they all put
  `x` at the same slot, `p.x` is one load. Otherwise the site gets an inline cache: compare the
  shape pointer, load; on a miss, look the field up by name in the shape.
- **`Value` words for mixed unions.** A union of different representations, a type parameter or
  `unknown` is one 64-bit word: numbers offset by 2^49, pointers stored raw with a 3-bit tag,
  `undefined` as 0. Boxing and unboxing are explicit HIR nodes. Narrowing is a tag test.
- **Generics by erasure.** A generic declaration compiles once, with its type parameters as
  `Value` words. Calls convert at the boundary.
- **Mutable captures live in heap cells** shared by the frame and its closures.

## What this costs you

Nothing in the source: you write ordinary TypeScript. The model is why some constructs are
rejected, though. Adding or deleting properties would change a shape after allocation
([CS1235](/reference/errors#cs1235)); passing a `number[]` where a `(number | string)[]` is
expected would let two representations alias one array ([CS1240](/reference/errors#cs1240)).

Next: [Memory and the garbage collector](/internals/memory).
