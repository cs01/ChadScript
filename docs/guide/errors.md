# Errors

`throw`, `try` / `catch` / `finally` (with or without a catch binding), rethrow, and `finally`
that runs on `return`, `break` and `continue` all behave as in Node. You can throw a string or
one of the four built-in error classes. `String(e)` of a caught error prints `Name: message`, as
in Node.

<<< @/examples/errors.ts

<<< @/examples/errors.out{text}

An error that escapes the program ends it with exit status 1, as in Node. The test suite compares
stdout and the exit code; the text of the report on stderr is not compared.

## Error classes

`Error`, `TypeError`, `RangeError` and `SyntaxError` can be created with `new`, thrown, caught,
and told apart with `instanceof`. After `instanceof`, read `.message` and `.name`:

<<< @/examples/error-classes.ts

<<< @/examples/error-classes.out{text}

## Limits today

- A class cannot extend `Error` or any other built-in class
  ([CS1000](/reference/errors#cs1000)). Throw a built-in error, and keep extra data in a variable
  of its own or return a result object instead.
- Only strings and the four error classes can be thrown. Throwing any other value (a number, an
  object, an instance of your own class) is not supported; today it stops with an internal
  compiler error ([CS9000](/reference/errors#cs9000)) instead of a clean rejection.
- An error has no `.stack`, and its fields cannot be assigned (`e.message = ...`)
  ([CS1000](/reference/errors#cs1000)).
- `console.log(e)` of a caught value is rejected ([CS1238](/reference/errors#cs1238)), because
  Node prints it with a stack trace. Print `String(e)` or `e.message`.

Next: [JSON](/guide/json).
