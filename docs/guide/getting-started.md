<script setup>
import { data } from "./toolchain.data";
</script>

# Getting started

ChadScript is pre-alpha and is built from source. There is no release binary yet.

## Prerequisites

- [bun](https://bun.sh) runs the compiler (it is TypeScript, and never compiles itself).
- clang and LLVM tools (`clang`, `opt`). Homebrew's `llvm` on macOS, `clang-18` and `llvm-18` on
  Ubuntu. Set `CHAD_CLANG` / `CHAD_OPT` to use specific binaries.
- The [Milo](https://github.com/milo-language/milo) compiler, which builds the runtime. You do
  not install it yourself: `scripts/setup-milo.sh` fetches the commit pinned in
  `scripts/milo-pin.sh` into `.milo/`.
- Node, only to compare results (it is the semantics oracle for the tests), and `rustc` if you
  want to run the benchmarks.

<div v-if="data.linksLibgc">

- The Boehm garbage collector, which the runtime uses until its own GC lands (see the
  [roadmap](/roadmap)): `brew install bdw-gc` or `apt install libgc-dev`. A Homebrew install is
  found automatically; `CHAD_GC_PREFIX` points at another prefix.

</div>

```sh
git clone https://github.com/cs01/ChadScript.git
cd ChadScript
bun install
sh scripts/setup-milo.sh
```

## Commands

```sh
bin/chad check file.ts            # typecheck + subset validation only, no binary
bin/chad build file.ts -o out     # native binary (-O2)
bin/chad run   file.ts [args...]  # build to a temp dir and run it
```

`check` is fast and answers "is this program in the subset?". A rejected program prints one
diagnostic per problem, each with a code from the [error reference](/reference/errors), and
exits with status 1.

The first build compiles the runtime once and caches the object file; later builds reuse it.

## A multi-file program

The entry file names the program; the compiler follows its imports (whole-program compilation).
Specifiers are written the way TypeScript resolves them: `./stats`, `./stats.js` and
`./stats.ts` all work.

::: code-group

<<< @/examples/getting-started/main.ts

<<< @/examples/getting-started/stats.ts

<<< @/examples/getting-started/format.ts

:::

```sh
$ bin/chad build main.ts -o stats && ./stats
```

<<< @/examples/getting-started/main.out{text}

The same entry runs under Node unchanged (`node --import tsx main.ts`; plain `node main.ts`
also works on a Node with type stripping when the imports use `.ts` extensions) and prints the
same bytes. That equivalence is what the
test suite checks for every sample on this site.

## Running the tests

```sh
bun run test         # fast lane: unit, rejection, admission and definition-of-done checks
bun run test:slow    # differential suite vs Node at -O0 and -O2, fuzzers, runtime tests
```

See [How it works](/internals/how-it-works#testing) for what each lane proves.

## Next

- [Language overview](/guide/language): what the subset covers, with examples.
- [Accepted subset](/reference/subset): the exact allowlist, generated from the validator.
