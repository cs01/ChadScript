# Unions and narrowing

A union of different kinds of values (`number | string`, `string[] | boolean | null`) is stored
as one 64-bit word with a small type tag. Narrowing with `typeof`, `===`, `instanceof`,
`Array.isArray`, truthiness or a `switch` on a discriminant is a tag test, and inside the
narrowed branch the value is unboxed again.

<<< @/examples/unions.ts

<<< @/examples/unions.out{text}

## What works on an un-narrowed union

Printing, `String(x)`, template interpolation, `===` / `!==`, `typeof`, `??` and truthiness work
on any union. Anything else (`x + 1`, `x.length`, calling a method) needs one kind first; the
compiler rejects it with [CS1239](/reference/errors#cs1239) and suggests the narrowing.

Unions of object types are one object type over their common fields, so a discriminated union
like `Event` above needs no tag word at all: `e.kind` is an ordinary field read.

## Limits today

- A union no runtime tag can tell apart, such as two different array types, is rejected
  ([CS1233](/reference/errors#cs1233)), as is a union used as a `Map` or `Set` key.
- Passing a `number[]` where a `(number | string)[]` is expected would let the callee write a
  string into your number array, so it is rejected ([CS1240](/reference/errors#cs1240)). Copy it
  into a new array of the wider type.
- `as` casts that narrow are not allowed; narrowing is done with runtime checks, which tsc then
  follows.

Next: [Generics](/guide/generics).
