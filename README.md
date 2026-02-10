# ChadScript

**Compile High-speed Apps Directly — from TypeScript to native binaries. No runtime.**

ChadScript compiles TypeScript directly to native machine code via LLVM IR. No Node.js, no V8, no interpreter. The output is a standalone ELF binary.

```bash
$ chad build examples/hello.ts -o /tmp/hello

$ time /tmp/hello
Hello from ChadScript!
This is native code - no Node.js runtime!

real	0m0.008s

$ file /tmp/hello
/tmp/hello: ELF 64-bit LSB executable, x86-64
```

ChadScript is self-hosting: the compiler can compile itself to a native binary, which can then compile programs without Node.js at all.

## Quick Start

### Install

Download the latest release from [GitHub Releases](https://github.com/cs01/ChadScript/releases), extract it, and add it to your PATH.

You'll also need LLVM, clang, and libcurl on your system:

```bash
# Ubuntu/Debian
sudo apt-get install llvm clang libcurl4-openssl-dev

# RHEL/Fedora
sudo dnf install llvm clang libcurl-devel

# macOS
brew install llvm
export PATH="/opt/homebrew/opt/llvm/bin:$PATH"
```

To build from source instead, see [BUILDING.md](BUILDING.md).

### Compile and Run

```bash
chad build examples/hello.ts
.build/examples/hello
```

Or compile and run in one step:

```bash
chad run examples/hello.ts
```

### CLI

```
chad <command> [options] <file>

Commands:
  build <file>     Compile to a native binary
  run <file>       Compile and run
  ir <file>        Emit LLVM IR only
  clean            Remove the .build directory

Options:
  -o <output>      Specify output file (default: .build/<input>)
  -v, --verbose    Show compilation steps
  --debug          Show internal debugging info
  --trace          Show everything (AST, IR, variable tracking)
```

The bare compiler is also available as `chadc`:

```bash
chadc hello.ts              # same as chad build hello.ts
chadc hello.ts -o myapp     # same as chad build hello.ts -o myapp
```

## What Works

**Core language:** functions, variables (`const`/`let`), arithmetic/logic operators, control flow (`if`/`else`/`while`/`for`/`for...of`), try/catch/throw, ternary expressions, classes with inheritance, enums

**Type system:** interfaces compile to native structs, type annotations, generics (`Map<K,V>`, `Set<T>`, `Array<T>`), import/export modules

**Standard library:**

| Module | APIs |
|--------|------|
| `console` | `log`, `error` |
| `process` | `argv`, `exit`, `env` |
| `fs` | `readFileSync`, `writeFileSync`, `existsSync`, `unlinkSync` |
| `path` | `join`, `resolve`, `dirname`, `basename` |
| `Math` | `floor`, `ceil`, `round`, `abs`, `min`, `max`, `sqrt`, `pow`, `random`, `PI`, `E`, `log`, `log2`, `log10`, `sin`, `cos`, `tan` |
| `JSON` | `parse<T>`, `stringify` |
| `String` | `length`, `split`, `indexOf`, `includes`, `slice`, `substr`, `trim`, `padStart`, `repeat`, `concat`, `replace`, `startsWith`, `endsWith`, `charAt` |
| `Array` | `length`, `push`, `pop`, `shift`, `map`, `filter`, `find`, `forEach`, `some`, `includes`, `slice`, `indexOf`, `join`, `concat`, `splice` |
| `Map` | `set`, `get`, `has`, `delete`, `size`, `keys`, `values` |
| `Set` | `add`, `has`, `delete`, `size` |
| `RegExp` | `test` |
| Networking | `fetch`, `httpServe` |
| Async | `async`/`await`, `Promise.all`, `setTimeout`, `setInterval` |
| Other | `parseInt`, `Date.now`, `child_process.execSync` |

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
$ chad build word-count.ts
$ .build/word-count README.md
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

## Development

See [BUILDING.md](BUILDING.md) for full build-from-source instructions.

```bash
npm install
bash scripts/build-vendor.sh
npm run build
npm test
```

## License

MIT
