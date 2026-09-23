<script setup>
import { data } from "./toolchain.data";
</script>

# Quickstart

From a fresh clone to a running native binary. ChadScript is pre-alpha and builds from source;
there is no release binary yet.

## 1. Install the prerequisites

You need [bun](https://bun.sh) (it runs the compiler) and LLVM's `clang` and `opt`.

::: code-group

```sh [macOS]
curl -fsSL https://bun.sh/install | bash
brew install llvm          # then put "$(brew --prefix llvm)/bin" on your PATH
```

```sh [Ubuntu]
curl -fsSL https://bun.sh/install | bash
sudo apt-get install -y clang-18 llvm-18
export CHAD_CLANG=clang-18 CHAD_OPT=opt-18
```

:::

<div v-if="data.linksLibgc">

The runtime also needs the Boehm garbage collector until its own collector lands:
`brew install bdw-gc` or `sudo apt-get install -y libgc-dev`.

</div>

## 2. Clone and set up

```sh
git clone https://github.com/cs01/ChadScript.git
cd ChadScript
bun install
sh scripts/setup-milo.sh      # fetches the pinned Milo compiler that builds the runtime
sh scripts/check-prereqs.sh
```

The last command checks everything in one go. Expect this (versions and paths will differ):

```text
ok       bun: 1.3.10
ok       clang: Homebrew clang version 22.1.8
ok       opt: Homebrew LLVM version 22.1.8
ok       milo: /home/you/ChadScript/.milo/milo
ok       dependencies: node_modules
ok       node: v25.3.0
optional rustc (rustc) not found: only needed for the benchmarks
ready: bin/chad can build programs
```

Any `MISSING` line names its fix. Node is optional for building; it is what the test suite
compares against.

## 3. Compile a program

Save this as `hello.ts` in the repository root. It is ordinary TypeScript: an interface, an
array of objects, a `Map`, a template string.

<<< @/examples/hello.ts

```sh
bin/chad run hello.ts
```

<<< @/examples/hello.out{text}

The first build also compiles the runtime and caches it; later builds reuse it. `run` builds
into a temp directory and runs the result. `build` writes the binary where you say:

```sh
bin/chad build hello.ts -o hello
./hello
ls -lh hello
```

The binary is self-contained: on macOS, `otool -L hello` lists only the system C library. The same
file runs under Node unchanged (`node hello.ts` on Node 23.6 or later) and prints the same
bytes.

## 4. See a rejection

Now a program outside the subset: it iterates a `Map` directly and uses loose equality. Save it
as `rejected.ts`:

<<< @/examples/rejected.ts

```sh
bin/chad check rejected.ts
```

<<< @/examples/rejected.err{text}

`check` runs only the type checker and the subset checks, so it is the fast way to ask "is this in
the subset?". Each diagnostic has a code (explained in the [error reference](/reference/errors)),
a location, and a rewrite that stays inside the subset. Applying both hints:

<<< @/examples/accepted.ts

<<< @/examples/accepted.out{text}

## Next

- [Build a multi-file project](/howto/multi-file), or [a CLI tool](/howto/cli-tool).
- [Language reference](/guide/language): what the subset covers, one topic per page.
- [Is ChadScript for you?](/reference/limitations): what fits today and what does not.
