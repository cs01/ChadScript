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

## What a caught value is

A caught value is the value that was thrown. For a thrown string, `typeof e` is `"string"`,
`e === "text"` compares the text, a `switch (e)` matches its cases, an empty string is falsy,
and `Number(e)` parses it. After `typeof e === "string"`, `e` is that string. For an error,
`typeof e` is `"object"` and `===` compares identity, as in Node:

<<< @/examples/caught-values.ts

<<< @/examples/caught-values.out{text}

## Limits today

- A class cannot extend `Error` or any other built-in class
  ([CS1000](/reference/errors#cs1000)). Throw a built-in error, and keep extra data in a variable
  of its own or return a result object instead.
- Only strings, the four error classes and caught values can be thrown. Throwing any other
  value (a number, an object, an instance of your own class, a value that may be `undefined`)
  is rejected ([CS1247](/reference/errors#cs1247)); throw `new Error(String(x))` instead.
- `&&`, `||` and `??` on a caught value are rejected
  ([CS1248](/reference/errors#cs1248)), because their result has no type ChadScript can hold.
  Test the value first, or convert it: `String(e) || "default"`. So is reading `e` after a
  test that proves it is a number or an array, which a thrown value never is, and assigning to
  a caught value.
- An error has no `.stack`, and its fields cannot be assigned (`e.message = ...`)
  ([CS1000](/reference/errors#cs1000)).
- `console.log(e)` of a caught value is rejected ([CS1238](/reference/errors#cs1238)), because
  Node prints it with a stack trace. Print `String(e)` or `e.message`.

Next: [JSON](/guide/json).
