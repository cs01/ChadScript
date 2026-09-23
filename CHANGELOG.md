# Changelog

## 2.0.0-alpha.1 (2026-09-23)

The first release of ChadScript 2: a from-scratch compiler that replaces the v1 compiler (whose
releases went up to 0.3.0-beta; its code lives on the `v1` branch). This is an alpha. ChadScript
compiles a statically analyzable subset of TypeScript ahead of time
to native binaries. A program the compiler accepts behaves like it does under Node (same stdout,
same exit code); every other program is rejected at compile time with a `CS####` code, the
source location and a suggested rewrite. `docs/SUBSET.md` is the generated list of what compiles.

The compiler runs from a source checkout under bun; no prebuilt binaries are published.

### Install

```sh
git clone https://github.com/cs01/ChadScript
cd ChadScript
bun install
sh scripts/setup-milo.sh    # fetches the pinned Milo compiler the runtime is written in
bin/chad doctor             # checks bun, node, clang/opt and Milo, then compiles a hello world
```

Requirements: bun 1.3, LLVM (`clang` and `opt`; CI uses LLVM 18 on Linux and Homebrew LLVM on
macOS), git, and Node.js 20.6 or newer for `--fallback=node` and the test suite. Tested on macOS
arm64 and Linux x86-64.

### Commands

- `chad check <file.ts>`: typecheck and validate, no output.
- `chad build <file.ts> -o <out>`: compile to a native binary.
- `chad run <file.ts> [args...]`: compile and run.
- `chad run --fallback=node <file.ts> [args...]`: if the program is rejected, print the
  diagnostics and run it under Node instead, with the same arguments and exit code.
- `chad doctor`: check the toolchain and compile a hello world, with a fix for each failure.
- `chad --version`: the compiler version and the pinned Milo commit.

### What compiles

- Types: `number`, `string`, `boolean`, `null`, `undefined`, arrays, closed object types
  (interfaces, type literals), classes, `Map`, `Set`, `T | undefined`, and unions of different
  kinds, narrowed with `typeof`, `===`, `instanceof`, `Array.isArray`, truthiness and `switch`.
  tsc is the only type checker; programs must pass it under strict settings.
- Functions and closures, including closures that capture and reassign variables; rest
  parameters; generics (compiled once per declaration).
- Classes: fields, constructors, methods, inheritance, `override`, `super`, `instanceof`, and a
  declared `toString()` used by string conversion.
- Control flow: `if`, `while`, `for`, `for...of` (arrays, Sets, Map `keys()`/`values()`),
  `switch`, `break`/`continue`, `try`/`catch`/`finally`, `throw`.
- Errors: `Error`, `TypeError`, `RangeError` and `SyntaxError` (constructed, thrown, caught,
  tested with `instanceof`, read through `.message` and `.name`), and thrown strings.
- Async: `async` functions, `await`, `Promise.resolve`, `Promise.all`, `new Promise` with a
  typed executor, `setTimeout`/`clearTimeout`; microtask order and the unhandled-rejection exit
  code match Node.
- Modules: ESM named, default and namespace imports, re-exports, `./x`, `./x.js` and `./x.ts`
  specifiers, and packages in `node_modules` that ship TypeScript source.
- Strings: template literals, concatenation, `String()` of any supported value (arrays join,
  objects are `[object Object]` or call their own `toString()`), and the methods listed in
  `docs/SUBSET.md` (`slice`, `split`, `replace`, `replaceAll`, `padStart`, `trim`, ...).
- Arrays: `map`, `filter`, `reduce`, `find`, `some`, `every`, `sort`, `flat`, `flatMap`, `join`,
  `push`, `pop`, `shift`, `slice`, `concat`, `includes`, `indexOf`, `reverse`, `at`, `forEach`.
- `Map` and `Set` with their common methods, and `new Map([[k, v], ...])` from pair literals.
- `console.log` with Node's `util.inspect` formatting (nesting, line breaking, `<ref *1>` and
  `[Circular *1]`) and format directives (`%s %d %i %f %j %o %O %c`).
- `JSON.stringify` (with indentation, and Node's `TypeError` for a cyclic value) and
  `JSON.parse` into a declared type, validated at run time.
- `Math`, `Number.isInteger`/`isFinite`/`isNaN`, `parseInt`, `parseFloat`, `Object.keys`,
  `Object.values`, `Date.now()`.
- `process.argv.slice(2)`, `process.exit`, `process.pid`; `node:fs` (`readFileSync`,
  `writeFileSync`, `appendFileSync`, `existsSync`, `unlinkSync`), `node:fs/promises`
  (`readFile`, `writeFile`, `appendFile`, `unlink`) and `node:path` (POSIX `join`, `resolve`,
  `normalize`, `dirname`, `basename`, `extname`, `isAbsolute`).

### Runtime

The runtime is written in Milo (compiled with a pinned commit) plus a small C file. Memory is
managed by ChadScript's own collector: conservative stack roots, a precise heap, Immix-style
blocks and lines, and bump allocation inlined into generated code. Values are NaN-boxed. A small
program builds to a self-contained binary of about 130 KB that starts in about 2 ms.

### Known limitations

- Strings are UTF-8 and match JavaScript exactly for ASCII text. Operations whose result
  depends on UTF-16 code units (`charCodeAt`, `<` on strings, ...) are rejected.
- Not supported: regular expressions, `Date` objects (only `Date.now()`), `enum`, `any`, `==`,
  `var`, `delete`, adding properties to an object after it is created, index signatures (use a
  `Map`), tuples of different element types, getters and setters, labeled statements, optional
  chains longer than one `?.`, `.then()` on promises (use `await`), spreading an array into the
  arguments of a library function.
- Only strings and the four Error classes can be thrown, and a class cannot extend `Error` (or
  any other built-in class). An error has no `.stack`.
- `JSON.parse` of malformed text throws a `SyntaxError` like Node, but the message text is
  ChadScript's own; a value that does not match the declared type throws an `Error`, where Node
  would return it unchecked.
- Generic type parameters hold numbers, strings, booleans, null, undefined and objects; arrays,
  Maps, Sets and functions as type arguments are rejected.
- `new Promise` needs its executor written inline with `resolve` (and `reject`) annotated.
- `--fallback=milojs` and prebuilt compiler binaries are not part of this release.
