<script setup>
import { data } from "./toolchain.data";
</script>

# Quickstart

From a fresh clone to a running native binary. With bun and LLVM already installed, every command
on this page (clone, setup, first build including the runtime, a rejection) finishes in seconds.
Nothing is released yet (2.0.0-alpha.1 is in preparation, see the
[changelog](https://github.com/cs01/ChadScript/blob/main/CHANGELOG.md)). ChadScript builds from a source checkout; there is no prebuilt binary
yet.

## 1. Install the prerequisites

You need [bun](https://bun.sh) 1.3 (it runs the compiler), LLVM's `clang` and `opt`, and
Node.js 20.6 or newer (for `--fallback=node` and the test suite). ChadScript is tested on macOS
arm64 and Linux x86-64.

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
bin/chad doctor
```

The last command checks everything in one go, then compiles and runs a hello world to prove the
whole path works. Expect this (versions will differ):

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

A failed check prints the fix on the next line. Node is only needed for `--fallback=node` and the
test suite; building programs does not use it.

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

## 5. Run it anyway with `--fallback=node`

When you are not sure a program fits the subset, `chad run --fallback=node` runs it either way.
If ChadScript rejects the file, it prints why and then runs the same file with Node instead,
with the same arguments and the same exit code. If the file compiles, it runs natively.

```sh
bin/chad run --fallback=node rejected.ts
```

```text
error[CS1222]: iterating a Map directly with `for...of` is not supported yet
  --> rejected.ts:6:1
  help: iterate its keys and read each value: `for (const k of m.keys())`
error[CS1203]: `==` is not supported
  --> rejected.ts:7:7
  help: use `===`

2 error(s)
chad: running the program under node instead (--fallback=node)
pears: sold out
```

## Next

- [Build a multi-file project](/howto/multi-file), or [a CLI tool](/howto/cli-tool).
- [Language reference](/guide/language): what the subset covers, one topic per page.
- [Is ChadScript for you?](/reference/limitations): what fits today and what does not.
