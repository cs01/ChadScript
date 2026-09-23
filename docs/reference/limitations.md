# Is ChadScript for you?

ChadScript is an alpha, not released yet (2.0.0-alpha.1 is in preparation, see the
[changelog](https://github.com/cs01/ChadScript/blob/main/CHANGELOG.md)). Every accepted program is
tested against Node, but the subset is still growing. Here is an honest fit check.

If you are not sure, run `chad check file.ts`: it tells you whether the file is in the subset,
and why not. A rejected file is still valid TypeScript and runs on Node unchanged.

## Good fit today

- **CLI tools and scripts** that read arguments and files, crunch data, and print results:
  startup is about a millisecond instead of tens of milliseconds, and the output is one small
  self-contained binary.
- **Startup-sensitive jobs**: things invoked thousands of times from shell loops, build steps or
  hooks.
- **Compute in plain TypeScript**: numeric loops, classes, maps and sets, closures. Several of the
  [benchmarks](/benchmarks) run 1.5 to 4 times faster than Node, startup included.
- **Code you want checked hard**: programs must pass tsc at maximum strictness, and anything the
  compiler cannot reproduce exactly is refused at compile time rather than approximated.

## Not a fit (yet, or ever)

| You need                                                                          | Status                                                                                                                             |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| npm packages that ship only JavaScript                                            | Never compiled; such a program should run on Node ([CS1226](/reference/errors#cs1226)). Packages that ship TypeScript source work. |
| `eval`, `new Function`, prototype changes, adding or deleting properties, `Proxy` | Never: they need a JavaScript engine, and the binary has none.                                                                     |
| DOM or browser APIs                                                               | Not a goal: ChadScript targets native command-line programs.                                                                       |
| HTTP servers, sockets, child processes, environment variables                     | Not yet. Only `node:fs`, `node:fs/promises` and `node:path` are built in.                                                          |
| Regular expressions, `Date` instances                                             | Planned ([CS1213](/reference/errors#cs1213), [CS1215](/reference/errors#cs1215)).                                                  |
| Non-ASCII strings                                                                 | Gated until the Unicode decision ([CS1216](/reference/errors#cs1216)): strings are UTF-8 and exact for ASCII.                      |
| Allocation-heavy workloads                                                        | Works, but the garbage collector is new and not yet generational; `binary_trees` is slower than Node today.                        |
| Windows                                                                           | Untested: CI runs on Linux and macOS.                                                                                              |

## Current limitations

Each of these is rejected at compile time with a specific code, never silently miscompiled:

- Optional and default parameters ([CS1217](/reference/errors#cs1217)); `let x;` without an
  initializer ([CS1218](/reference/errors#cs1218)).
- Getters, setters, `static`, `private`, `readonly`, `abstract`, and methods written inside object
  literals ([CS1000](/reference/errors#cs1000)).
- `toFixed` and the other number formatting methods ([CS1221](/reference/errors#cs1221)).
- Iterating a `Map` directly, `Map.entries()`, and tuples of mixed types
  ([CS1222](/reference/errors#cs1222), [CS1233](/reference/errors#cs1233)).
- Generics instantiated with arrays, maps or functions ([CS1242](/reference/errors#cs1242)).
- `enum`, `namespace`, decorators, `var`, `==`
  ([CS1202](/reference/errors#cs1202), [CS1209](/reference/errors#cs1209),
  [CS1208](/reference/errors#cs1208), [CS1212](/reference/errors#cs1212),
  [CS1203](/reference/errors#cs1203)).
- `Promise.reject`, `Promise.race`, top-level `await`
  ([CS1220](/reference/errors#cs1220), [CS1000](/reference/errors#cs1000)); `.then()` on a
  promise ([CS1225](/reference/errors#cs1225)), use `await`.
- `new Promise` unless its executor is written inline with `resolve` (and `reject`) annotated
  ([CS1000](/reference/errors#cs1000)); see [async / await](/guide/async#new-promise).
- A class that extends `Error` or any other built-in class, `.stack` on an error, and assigning
  to an error's fields ([CS1000](/reference/errors#cs1000)).
- Throwing anything but a string, one of the four error classes (`Error`, `TypeError`,
  `RangeError`, `SyntaxError`) or a caught value ([CS1247](/reference/errors#cs1247)), and
  `&&`, `||` or `??` on a caught value ([CS1248](/reference/errors#cs1248)).
- Spreading an array into the arguments of a library function (`Math.max(...xs)`)
  ([CS1000](/reference/errors#cs1000)).
- `new Map(...)` from anything but an array literal of pairs
  ([CS1000](/reference/errors#cs1000)).
- Converting a function, an object with `valueOf`, or an object whose own `toString()` its
  declared type does not declare into a string ([CS1238](/reference/errors#cs1238)).
- Regular expressions, `Date` objects (only `Date.now()` works), `any`, `delete`, adding
  properties to an object after it is created, index signatures (use a `Map`), labeled
  statements, and optional chains longer than one `?.`.
- Strings are UTF-8 and exact for ASCII text; operations whose result depends on UTF-16 code
  units (`charCodeAt`, `<` on strings, ...) are rejected ([CS1216](/reference/errors#cs1216)).

Other differences in this release:

- `JSON.parse` of malformed text throws a `SyntaxError` like Node, but the message text is
  ChadScript's own. A document that does not match the declared type throws an `Error`, where
  Node would return it unchecked ([JSON](/guide/json)).
- Generic type parameters hold numbers, strings, booleans, null, undefined and objects; arrays,
  Maps, Sets and functions as type arguments are rejected ([CS1242](/reference/errors#cs1242)).
- There are no prebuilt compiler binaries: ChadScript runs from a source checkout under bun.

The full list of what is accepted is the [subset reference](/reference/subset); every rejection
is explained in the [error reference](/reference/errors).

## If a program compiles but behaves differently from Node

That is a P0 bug, never a known quirk: the one deliberate exception is
[`JSON.parse` shape checking](/guide/json). Please
[open an issue](https://github.com/cs01/ChadScript/issues/new?title=divergence%3A+) with the
program and both outputs.

Next: [Quickstart](/guide/getting-started), or the [roadmap](/roadmap).
