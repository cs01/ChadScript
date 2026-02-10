# ChadScript

**A TypeScript-to-native compiler. Write TypeScript, get native binaries. No runtime.**

ChadScript compiles TypeScript directly to native machine code via LLVM IR. No Node.js, no V8, no interpreter. The output is a standalone ELF binary.

```bash
$ npx tsx src/index.ts examples/hello.ts /tmp/hello

$ time /tmp/hello
Hello from ChadScript!
This is native code - no Node.js runtime!

real	0m0.008s

$ file /tmp/hello
/tmp/hello: ELF 64-bit LSB executable, x86-64
```

ChadScript is self-hosting: the compiler can compile itself to a native binary, which can then compile programs without Node.js at all.

## Quick Start

### Prerequisites

**System packages:**

```bash
# Ubuntu/Debian
sudo apt-get install llvm clang libcurl4-openssl-dev libcjson-dev libuv1-dev libgc-dev

# RHEL/Fedora
sudo dnf install llvm clang libcurl-devel cjson-devel libuv-devel gc-devel

# macOS
brew install llvm cjson libuv
export PATH="/opt/homebrew/opt/llvm/bin:$PATH"
```

**Vendored dependencies:**

ChadScript links against [Boehm GC](https://github.com/ivmai/bdwgc) for garbage collection and [Mongoose](https://github.com/cesanta/mongoose) for embedded HTTP. Build them into `vendor/`:

```bash
git clone https://github.com/ivmai/bdwgc vendor/bdwgc
cd vendor/bdwgc && ./autogen.sh && ./configure && make && cd ../..

git clone https://github.com/cesanta/mongoose vendor/mongoose
cc -c vendor/mongoose/mongoose.c -o vendor/mongoose/mongoose.o
```

Or point to existing builds:
```bash
export CHADSCRIPT_BDWGC_PATH=/path/to/bdwgc
export CHADSCRIPT_MONGOOSE_PATH=/path/to/mongoose
```

### Compile and Run

```bash
git clone https://github.com/cs01/ChadScript && cd ChadScript
npm install
npx tsx src/index.ts examples/hello.ts ./hello
./hello
```

### Compiler Options

```
npx tsx src/index.ts [options] <input.ts> [output]

  -v, --verbose    Show compilation steps
  --debug          Show internal debugging info
  --trace          Show everything (AST, IR, variable tracking)
```

## What Works

**Core language:** functions, variables (`const`/`let`), arithmetic/logic operators, control flow (`if`/`else`/`while`/`for`/`for...of`), try/catch/throw, ternary expressions, classes with inheritance, enums

**Type system:** interfaces compile to native structs, type annotations, generics (`Map<K,V>`, `Set<T>`, `Array<T>`), import/export modules

**Data structures:** `Array`, `String`, `Map`, `Set`, `RegExp` with standard methods (`push`, `pop`, `filter`, `find`, `forEach`, `some`, `includes`, `split`, `indexOf`, `slice`, `map`, etc.)

**Built-in APIs:** `console.log`, `process.argv`, `process.exit`, `fs.readFileSync`, `path.join`, `fetch`, `JSON.parse<T>`, `JSON.stringify`, `parseInt`, `Math.*`, `httpServe`, `async`/`await`, `Promise.all`, `setTimeout`/`setInterval`

## Examples

```typescript
// word-count.ts - a real CLI tool
function countStats(content: string): void {
  const words = content.split(" ");
  console.log("Words: ");
  console.log(words.length);
}

const filename = process.argv[0];
const content = fs.readFileSync(filename);
countStats(content);
```

```bash
$ npx tsx src/index.ts word-count.ts ./wc
$ ./wc README.md
Words: 437
```

See `examples/` for more: CLI argument parsing, HTTP servers, timers.

## Limitations

- **No discriminated unions** - Types map to fixed LLVM representations (`string` → `i8*`, `number` → `double`). `string | null` works (same repr), but `string | number` is rejected at compile time. Tagged unions may come later.
- **No dynamic features** - No `eval`, `typeof`, `Object.keys()`, destructuring, spread, optional chaining
- **No reflection** - No `instanceof`, `for...in`, runtime type inspection

## Architecture

```
TypeScript source
    → TypeScript Compiler API (parse + type info)
    → AST
    → Semantic analysis
    → LLVM IR generation
    → llc (LLVM IR → object file)
    → clang (link against libgc, libcurl, libcjson, libuv, mongoose)
    → native binary
```

The compiler is ~45k lines of TypeScript across ~70 source files in `src/`.

### Self-Hosting

ChadScript can compile its own compiler to a native binary:

```bash
# Stage 0: compile the compiler with Node.js
npx tsx src/index.ts src/native-compiler.ts /tmp/chadscript-stage0

# Stage 1: compile the compiler with itself
/tmp/chadscript-stage0 src/native-compiler.ts /tmp/chadscript-stage1
```

The Stage 1 binary is a standalone native compiler that needs no Node.js runtime.

## Development

```bash
npm install
npm test          # run all tests (222 tests)
npm run typecheck # run tsc --noEmit
```

## License

MIT
