# console.log

`console.log` prints exactly what Node prints: numbers in JavaScript's shortest round-trip form
(`0.1 + 0.2` is `0.30000000000000004`, `-0` prints as `-0`), strings quoted
inside containers, class names before instances, `Map(n) {...}` and `Set(n) {...}`, and Node's
line breaking once a value gets wide. Format directives (`%s`, `%d`, `%i`, `%f`, `%j`, `%o`,
`%O`, `%c`, `%%`) apply when the first argument is a string.

<<< @/examples/console.ts

<<< @/examples/console.out{text}

Every object carries its runtime shape, so printing reads the real fields of the real object,
even when it is reached through an interface or a union.

## Values as text

`String(x)`, template literals, `+` with a string, and `join` convert values the way Node does:
arrays join their elements with commas, a plain object is `[object Object]`, and an instance of
a class that declares `toString(): string` converts by calling it.

<<< @/examples/to-string.ts

<<< @/examples/to-string.out{text}

Converting a function (Node prints its source text), an object with a `valueOf` method, or an
object whose own `toString()` its declared type does not declare is rejected
([CS1238](/reference/errors#cs1238)). So is `join` on an array of objects that have their own
`toString()`.

## Limits today

- A value that can hold something the runtime cannot render the way Node does (for example a
  promise) is rejected in `console.log` and `JSON.stringify` ([CS1238](/reference/errors#cs1238)).
- `console.log` is the only console method today; `console.error` and the others fail to
  typecheck ([CS0001](/reference/errors#cs0001)).

Next: [Accepted subset](/reference/subset), the complete list.
