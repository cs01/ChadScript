# Closures

Arrow functions and function expressions capture variables by reference, exactly as in
JavaScript. A local that a closure captures **and** something reassigns lives in a heap cell
shared by the frame and every closure; variables that are never reassigned are captured by value,
which costs nothing extra. `for (let ...)` and `for...of` give each iteration its own binding.

<<< @/examples/closures.ts

<<< @/examples/closures.out{text}

Functions are values: they can be stored in arrays and fields, passed, returned and compared
with `===`.

## Limits today

- `this` inside a `function` expression is rejected; use an arrow function or a class method.
- A `function` declaration nested inside another function or block is rejected
  ([CS1000](/reference/errors#cs1000)); bind an arrow function with `const`, or move it to the
  top level.
- Built-ins such as `String` or `Math.floor` cannot be passed as values
  ([CS1246](/reference/errors#cs1246)); wrap them: `xs.map((x) => String(x))`.
- Reading a narrowed variable that a closure reassigns, after a call that might run the closure,
  is rejected ([CS1241](/reference/errors#cs1241)), because tsc's narrowing can be stale there.
