# CLI

`bin/chad` is a small wrapper that runs the compiler under bun from any directory (symlink it onto
your `PATH` if you like).

| Command                                             | What it does                                                                      | Exit status                               |
| --------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------- |
| `bin/chad check <entry.ts>`                         | Typecheck and validate only; no binary. Prints `ok: typechecks and is in-subset`. | 0, or 1 with diagnostics                  |
| `bin/chad build <entry.ts> -o <out>`                | Compile the entry file and everything it imports to a native binary at `-O2`.     | 0, or 1 with diagnostics                  |
| `bin/chad run <entry.ts> [args...]`                 | Build into a temp directory, then run the binary with `args`.                     | the program's exit status                 |
| `bin/chad run --fallback=node <entry.ts> [args...]` | Like `run`, but a rejected program runs under Node instead (see below).           | the program's exit status, native or Node |
| `bin/chad doctor`                                   | Check bun, node, clang, opt and Milo, then compile and run a hello world.         | 0 when every check passes, else 1         |
| `bin/chad --version`                                | Print the compiler version and the pinned Milo commit.                            | 0                                         |

Diagnostics go to stderr, one per problem, followed by a count:

<<< @/examples/rejected.err{text}

## `run --fallback=node`

If ChadScript rejects the file, `--fallback=node` prints the diagnostics as usual, then runs the
same file with Node instead: same arguments, same standard input and output, and `chad` exits
with Node's exit code. If the file compiles, it runs natively and Node is not involved. It is a
way to use `chad run` on any TypeScript file without first checking that it fits the subset.
Node runs the file through [tsx](https://tsx.is), which ChadScript installs with its own
dependencies, so the program does not need to install anything.

This program uses `==`, which the subset does not include:

<<< @/examples/fallback.ts

<<< @/examples/fallback.err{text}

With `--fallback=node` it still runs, and the exit code is the program's:

```text
$ bin/chad run --fallback=node fallback.ts hello world
error[CS1203]: `==` is not supported
  --> fallback.ts:4:5
  help: use `===`

1 error(s)
chad: running the program under node instead (--fallback=node)
2 word(s): hello world
$ echo $?
3
```

`--fallback=node` needs Node.js 20.6 or newer; `chad doctor` checks it. An internal compiler
error (CS9000, always a ChadScript bug) also falls back to Node; please
[report it](https://github.com/cs01/ChadScript/issues).

## `doctor`

`bin/chad doctor` checks each tool the compiler needs, prints the fix for anything missing, and
finally compiles and runs a hello world:

```text
  ok    bun          1.3.10
  ok    node         v25.3.0
  ok    tsx          loads under node (for --fallback=node)
  ok    clang        22.1.8 (clang)
  ok    opt          22.1.8 (opt)
  ok    milo         pinned ba9484985954
  ok    hello world  compiled and ran

all checks passed
```

## `--version`

```text
$ bin/chad --version
chad 2.0.0-alpha.1 (milo ba9484985954aa8ecd7df24517dede04e7484a0a)
```

## Environment variables

| Variable           | Effect                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------- |
| `CHAD_CLANG`       | The `clang` to compile and link with (default `clang`), e.g. `clang-18`.                |
| `CHAD_OPT`         | The `opt` used by the test suite's IR verification (default `opt`).                     |
| `CHAD_MILO`        | A `milo` compiler to build the runtime with, instead of the pinned one in `.milo/`.     |
| `CHAD_SAN=1`       | Build the runtime and the program with AddressSanitizer and UndefinedBehaviorSanitizer. |
| `CHAD_GC_STRESS=N` | Collect garbage before every Nth allocation (debugging the collector).                  |
| `CHAD_GC_VERIFY=1` | Poison freed memory and check traced pointers during collection.                        |

The runtime is compiled on first use and cached under `.build/`; the cache key includes the
runtime sources, the Milo commit and the build flags.

## Repository scripts

| Command                       | What it does                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `sh scripts/check-prereqs.sh` | Check bun, clang, opt, Milo and dependencies (`bin/chad doctor` does more).         |
| `sh scripts/setup-milo.sh`    | Fetch the pinned Milo compiler into `.milo/`.                                       |
| `bun run test`                | Fast lane (under 10 s): unit, rejection, admission and definition-of-done tests.    |
| `bun run test:slow`           | Every test program checked against Node at `-O0` and `-O2`, fuzzers, runtime tests. |
| `bun run scripts/bench.ts`    | Benchmarks: ChadScript vs Node vs Rust.                                             |

Next: [Accepted subset](/reference/subset).
