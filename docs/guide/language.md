# Language overview

ChadScript compiles a subset of TypeScript. The subset is not a dialect: every accepted program
is valid TypeScript with the same meaning, and it runs unchanged under Node. What changes is the
set of programs the compiler agrees to build.

## The rules in one screen

1. **It must typecheck at maximum strictness.** `strict`, `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`, `noImplicitOverride` and `noPropertyAccessFromIndexSignature`
   are always on, with zero diagnostics allowed. Array reads are `T | undefined`, so you narrow or
   default them (`xs[i] ?? 0`).
2. **Every construct must be one the compiler supports.** The [accepted subset](/reference/subset)
   lists them, straight from the compiler's own tables. Anything else is rejected with a
   [code](/reference/errors) and a rewrite.
3. **Objects keep the shape they were created with.** No adding or deleting properties, no
   prototype edits. Optional fields (`x?: T`) are how you model "maybe present".
4. **Types decide the machine layout.** `number`, `string` and `boolean` are stored directly.
   A union of different kinds (`number | string`) carries a small type tag, and you narrow it
   (`typeof x === "number"`) before most operations.
5. **Strings are UTF-8 and exact for ASCII.** Operations whose results depend on UTF-16 code
   units (`charCodeAt`, `s[i]`, `<` on strings, non-ASCII literals) are rejected for now, not
   approximated.

## Topics

Every example on these pages is a file in
[`docs/examples/`](https://github.com/cs01/ChadScript/tree/main/docs/examples). The test suite
compiles each one and checks that the binary's output matches Node's at `-O0` and `-O2`, and that
the output shown on the page is what Node prints.

| Topic                                        | Covers                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| [Modules and imports](/guide/modules)        | named, default, namespace and type-only imports; re-exports; packages      |
| [Classes and interfaces](/guide/classes)     | inheritance, `super`, `override`, `instanceof`, interface dispatch         |
| [Unions and narrowing](/guide/unions)        | `typeof`, `===`, `Array.isArray`, discriminated unions, `??`               |
| [Generics](/guide/generics)                  | generic functions and classes, constraints, erasure                        |
| [Closures](/guide/closures)                  | captured mutable variables, per-iteration bindings, higher-order functions |
| [Map and Set](/guide/collections)            | counting, iteration order, spreading keys                                  |
| [async / await](/guide/async)                | Node's microtask ordering, `Promise.all`, timers, rejections               |
| [Errors](/guide/errors)                      | `throw`, `try`/`catch`/`finally`, uncaught errors                          |
| [JSON](/guide/json)                          | typed `JSON.parse` with shape checking, `JSON.stringify`                   |
| [node:fs and node:path](/guide/node-modules) | sync and promise file APIs, path helpers, `process.argv`                   |
| [console.log](/guide/console)                | `util.inspect` formatting and format directives                            |

## Not in the subset

Permanently out, because they need a JavaScript engine rather than a compiler: `any`, `eval` and
`new Function`, prototype mutation, adding or deleting properties at run time, `Proxy`,
CommonJS, and packages that ship only JavaScript. Programs that need them should run on Node.

Not yet, planned: regular expressions, `Date` instances, optional and default parameters,
getters and setters, `toFixed`, generics instantiated with arrays or functions (wrap them in an
object), optional chains longer than one `?.`, and `Map`/`Set` keyed by a union. Each is rejected
today with a specific code; see the [roadmap](/roadmap).

Next: [Modules and imports](/guide/modules).
