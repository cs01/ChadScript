# Is ChadScript for you?

ChadScript is pre-alpha. The pipeline works end to end and every accepted program is tested
against Node, but the subset is still growing and nothing has been released. Here is an honest
fit check.

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
  ([CS1220](/reference/errors#cs1220), [CS1000](/reference/errors#cs1000)).

Known holes, where a construct slips past the compile-time checks and stops with an internal compiler error
or a crash instead of a clean rejection. Each is pinned by a `@known-bug` test that fails the
suite once the bug is fixed, so the list cannot silently go stale:

- `new Promise(executor)`, `class X extends Error`, `new Map(entries)`, and an array
  interpolated into a template literal: internal compiler error.
- Reading `e.message` after `e instanceof Error` in a `catch`: crashes at run time.
- `JSON.stringify` of an object that contains itself: overflows the stack instead of throwing
  `TypeError` as Node does.

The full list of what is accepted is the [subset reference](/reference/subset); every rejection
is explained in the [error reference](/reference/errors).

## If a program compiles but behaves differently from Node

That is a P0 bug, never a known quirk: the one deliberate exception is
[`JSON.parse` shape checking](/guide/json). Please
[open an issue](https://github.com/cs01/ChadScript/issues/new?title=divergence%3A+) with the
program and both outputs.

Next: [Quickstart](/guide/getting-started), or the [roadmap](/roadmap).
