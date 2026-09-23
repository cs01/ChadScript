# Build a CLI tool

A small `wc`: it takes file names as arguments, prints line, word and byte counts, and exits with
status 1 if a file is missing. It uses `process.argv.slice(2)`, `node:fs`, `node:path`, an
interface and array methods.

<<< @/examples/wc/main.ts

## Build and run

```sh
bin/chad build main.ts -o wc
./wc poem.txt missing.txt notes.txt; echo "exit $?"
```

<<< @/examples/wc/main.out{text}

```text
exit 1
```

The docs test suite runs exactly this (with the paths on the program's first line) under Node
and as a native binary, and compares stdout and the exit code. The input files:

::: code-group

<<< @/examples/wc/poem.txt

<<< @/examples/wc/notes.txt

:::

## Things to know

- Only `process.argv.slice(2)` is accepted ([CS1229](/reference/errors#cs1229)): Node's
  `argv[0]` and `argv[1]` (the node binary and the script path) have no equivalent in a compiled
  binary.
- `process.exit(code)` sets the exit status; an uncaught error exits with 1, as in Node.
- The binary starts in about a millisecond, so it is cheap to call from scripts and loops; see
  [Benchmarks](/benchmarks#startup-and-size).
- Strings are UTF-8 and exact for ASCII. Counting bytes as `text.length` is right here because the
  input is ASCII; non-ASCII string literals are rejected for now
  ([CS1216](/reference/errors#cs1216)).

Next: [Language reference](/guide/language).
