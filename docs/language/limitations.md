# Limitations

ChadScript uses TypeScript syntax but compiles to native code with different semantics. These are the current limitations.

## No Discriminated Unions

Types map to fixed LLVM representations (`string` -> `i8*`, `number` -> `double`). Union types like `string | null` work when both sides share the same representation, but `string | number` is rejected at compile time.

Tagged unions may come in a future version.

## No Dynamic Features

- No `eval()`
- No optional chaining (`?.`)
- No runtime type manipulation
- No computed property names

## No Reflection

- No `instanceof`
- No `for...in`
- No runtime type inspection
- No `Reflect` API

## No User-Defined Generics

Built-in generics work:
- `Map<K, V>`
- `Set<T>`
- `Array<T>`
- `.json<T>()`

But you cannot define your own generic functions or classes yet.

## No npm Compatibility

ChadScript is not a Node.js replacement. npm packages assume V8 semantics, a specific GC model, and Node APIs that don't exist in ChadScript.

## No REPL

ChadScript compiles to native code. There is no interpreter or REPL mode.

## Other Differences

- All numbers are `double` (64-bit float) — there are no integers
- No closures over mutable variables (closures capture by value)
- No `async` generators
- No decorators
- No `Symbol`
