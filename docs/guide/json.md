# JSON

`JSON.parse` needs a declared target type: `const cfg: Config = JSON.parse(text)`. The
annotation is not a cast. The compiler generates a checker for that type, and the parsed document
must match it: every required field present with the right kind, arrays of the right element
type, optional fields absent or matching. `JSON.stringify` works on any accepted value, including
the `null, 2` indent form.

<<< @/examples/json.ts

<<< @/examples/json.out{text}

## The one deliberate difference from Node

In Node, `JSON.parse` returns whatever the text contains, and a wrong-shaped document surfaces
later as `undefined` or a string where a number was expected. A compiled program cannot carry a
value that contradicts its static type, so ChadScript **throws at the parse** instead:

<<< @/examples/json-mismatch.ts

<<< @/examples/json-mismatch.out{text}

Node prints `port + 1 = 80801` for this program. This is the only place where an accepted program
is allowed to behave differently from Node, it is fixed in the charter ("`JSON.parse` validates
against the declared type and throws on mismatch"), and it is tested directly instead of against
Node. Malformed JSON throws in both.

Keys the type does not declare are kept, so printing or re-serializing a parsed object shows
them as Node would.

## Limits today

- `JSON.parse` without a target annotation, with a reviver, or into a union that mixes object
  types with other kinds is rejected ([CS1214](/reference/errors#cs1214)).
- Spreading an object made by `JSON.parse` is rejected ([CS1236](/reference/errors#cs1236)),
  because its key order is only known at run time. Copy the fields you need.
- Non-ASCII text is refused rather than approximated, as everywhere in the subset today.

Next: [node:fs and node:path](/guide/node-modules).
