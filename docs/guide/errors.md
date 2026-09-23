# Errors

`throw`, `try` / `catch` / `finally` (with or without a catch binding), rethrow, and `finally`
that runs on `return`, `break` and `continue` all behave as in Node. Any value can be thrown.
`new Error(message)` prints as Node prints it, and `e instanceof Error` tests a caught value.

<<< @/examples/errors.ts

<<< @/examples/errors.out{text}

An error that escapes the program ends it with exit status 1, as in Node. The test suite compares
stdout and the exit code; the text of the report on stderr is not compared.

## Limits today

- Custom error classes (`class MyError extends Error`) are not supported yet. Today they slip past
  the validator and stop with an internal compiler error; a known-bug test tracks the fix.
- Reading `e.message` after narrowing a caught value with `instanceof Error` compiles but crashes
  today. It is recorded as a known-bug test that must keep failing until it is fixed; use
  `String(e)` (which prints `Error: message`) meanwhile.
