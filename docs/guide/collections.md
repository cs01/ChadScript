# Map and Set

`Map` and `Set` follow JavaScript's semantics: insertion-ordered iteration, SameValueZero keys
(`NaN` equals `NaN`, `-0` equals `0`), and iterators that see entries added or deleted during
iteration the way Node's do.

<<< @/examples/collections.ts

<<< @/examples/collections.out{text}

The supported methods are listed, generated from the validator, in the
[subset reference](/reference/subset#supported-map-methods).

## Limits today

- Iterating a `Map` directly (`for (const [k, v] of m)`) and `m.entries()` are rejected
  ([CS1222](/reference/errors#cs1222)); iterate `m.keys()` and read `m.get(k)`.
- Tuples with different element types (`[string, number]`) are rejected
  ([CS1233](/reference/errors#cs1233)); use an object with named fields.
- A union as the key type is rejected ([CS1233](/reference/errors#cs1233)).
- Plain objects are not dictionaries: index signatures (`{ [k: string]: T }`) are rejected
  ([CS1207](/reference/errors#cs1207)). Use a `Map`.
