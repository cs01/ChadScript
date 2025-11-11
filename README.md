# ChadScript - Build Fast CLIs in TypeScript

**Write TypeScript, compile to native binaries. Performance like Rust/C++, syntax like TypeScript.**

```bash
npx tsx src/index.ts myfile.ts    # Creates ./myfile native executable
./myfile                          # Instant startup, zero runtime overhead
```

## Why ChadScript?

Build command-line tools in TypeScript that run as **fast as C/Rust** with **instant startup** and **tiny binaries** (15-30KB). No Node.js runtime, no V8, no garbage collector. Your TypeScript compiles directly to native machine code via LLVM.

Perfect for:
- **Fast CLI tools** (file processors, text utilities, system tools)
- **Network servers** (HTTP servers, TCP services)
- **System utilities** (parsers, converters, automation scripts)
- **Performance-critical code** where startup time matters

```typescript
// Word counter CLI - compiles to 20KB native binary
const content = fs.readFileSync(process.argv[1]);
const lines = content.split("\n").length;
console.log("Lines: " + lines);
process.exit(0);
```

**Native performance:**
- 0ms startup time (vs 50-200ms for Node.js)
- 15-30KB binaries (vs 50MB+ for bundled Node apps)
- Direct syscalls, no runtime overhead
- Ahead-of-time compilation via LLVM

## Quick Start

### Prerequisites

- **LLVM** (`llc`) - Compiler backend
- **C Compiler** - Clang or GCC
- **libcurl** - For `fetch()` support
- **libcjson** - For `JSON.parse<T>()` with TypeScript interfaces

### Installation

**macOS:**
```bash
brew install llvm cjson
export PATH="/opt/homebrew/opt/llvm/bin:$PATH"  # Add to ~/.zshrc
```

**Ubuntu/Debian:**
```bash
sudo apt-get install llvm clang libcurl4-openssl-dev libcjson-dev
```

**RHEL/Fedora/CentOS:**
```bash
sudo dnf install llvm clang libcurl-devel cjson-devel
```

### Using ChadScript

**Install globally:**

```bash
npm install -g chadscript
chadscript hello.ts          # Compile to native
./hello                      # Run your program
```

**Or use from repo:**

```bash
git clone https://github.com/yourusername/chadscript
cd chadscript
npm install
npx tsx src/index.ts hello.ts
./hello
```

## Examples

### Import/Export (Module System)

```typescript
// math.ts
export function add(a: number, b: number): number {
  return a + b;
}

// main.ts
import { add } from './math.js';  // .js extension required
console.log(add(5, 7));
```

### CLI Argument Parsing (ArgumentParser)

**Built-in argparse-style parser** for professional CLI tools:

```typescript
import { ArgumentParser } from './lib/argparse.js';

const parser = new ArgumentParser('my-cli', 'My awesome CLI tool');
parser.addFlag('verbose', 'v', 'Enable verbose output');
parser.addOption('output', 'o', 'Output file', 'out.txt');
parser.addPositional('input', 'Input file to process');

const args = parser.parse(process.argv);

if (parser.getFlag(args, 'verbose')) {
  console.log("Verbose mode!");
}
const output = parser.getOption(args, 'output');
const input = parser.getPositional(args, 0);
```

Features:
- Boolean flags (`-v`, `--verbose`)
- Options with values (`-o file.txt`, `--output file.txt`)
- Positional arguments
- Automatic `--help` generation
- Default values
- Error handling for unknown flags

See `examples/argparse-cli.ts` for a complete example.

### File System Operations

```typescript
// Read/write files
const content = fs.readFileSync("input.txt");
fs.writeFileSync("output.txt", content);
fs.unlinkSync("temp.txt");

// Path operations
const abs = path.resolve("./file.txt");
const dir = path.dirname(abs);
```

### Console & Process

```typescript
console.log("Hello!");           // Print to stdout
process.exit(0);                 // Exit with code
const args = process.argv;       // Command-line args
```

### Arrays & Functional Programming

```typescript
const nums = [1, 2, 3, 4, 5];
const doubled = nums.map(n => n * 2);                    // [2, 4, 6, 8, 10]
const evens = nums.filter(n => n % 2 === 0);             // [2, 4]
const sum = nums.reduce((a, b) => a + b, 0);             // 15

// Other methods: push, pop, find, some, forEach, slice, concat, indexOf, join
```

### Strings

```typescript
const str = "Hello";
const upper = str.toUpperCase();         // String methods
const sub = str.substring(0, 3);         // "Hel"
const parts = str.split("");             // ["H", "e", "l", "l", "o"]
const repeated = str.repeat(3);          // "HelloHelloHello"
const char = str.charAt(0);              // "H"

// Methods: concat, substr, substring, repeat, padStart, split, indexOf, charAt
```

### TypeScript Interfaces (Compile to Native Structs)

```typescript
interface Point { x: number; y: number; }

const points = [{x: 1, y: 2}, {x: 3, y: 4}, {x: 5, y: 6}];
const sums = points.map(p => p.x + p.y).filter(n => n > 5).join(", ");
console.log(sums);  // "7, 11" - TypeScript → native code, no V8!
```

Interfaces compile to **native structs** with direct field access - no hash tables, no runtime overhead.

### JSON Parsing with TypeScript Interfaces

**Parse JSON responses with type safety using TypeScript interfaces:**

```typescript
interface RepoInfo {
  stargazers_count: number;
  name: string;
}

// Fetch GitHub repo data
const url = "https://api.github.com/repos/" + repo;
const response = fetch(url);

// Parse with type checking (inline access recommended)
console.log(JSON.parse<RepoInfo>(response).stargazers_count);
```

The compiler:
1. Uses your TypeScript interface to generate proper JSON field access
2. Adds runtime type checking (ensures fields match expected types)
3. Uses cJSON's portable API (works on Linux, macOS, Windows)
4. Generates efficient native code with zero runtime overhead

See `examples/github-stars.ts` for a complete example:

```bash
# Compile the example
npx tsx src/index.ts examples/github-stars.ts examples/github-stars

# Test it
./examples/github-stars facebook/react
# Output: 240511
```

### Classes

```typescript
class Counter {
  count: number;

  constructor(start: number) {
    this.count = start;
  }

  increment(): void {
    this.count = this.count + 1;
  }
}

const c = new Counter(0);
c.increment();
```

Supports inheritance and method overriding.

## Examples

See `/examples/` for working examples: CLI tools (`hello.ts`, `word-count.ts`), network servers (`tcp-server.ts`, `simple-http-server.ts`), and more.

```bash
npx tsx src/index.ts examples/word-count.ts
./examples/word-count README.md
```

## What Works

**Core Language:** Functions, variables (`const`/`let`), operators, control flow (`if`/`while`/`for`), try/catch, ternary

**TypeScript:** Interfaces → structs, type annotations, classes with inheritance

**Data Structures:**
- **Arrays:** `push`, `pop`, `map`, `filter`, `find`, `some`, `forEach`, `slice`, `concat`, `indexOf`, `join`, `reduce`
- **Strings:** `concat`, `substr`, `substring`, `repeat`, `padStart`, `charAt`, `split`, `indexOf`, `toUpperCase`, `toLowerCase`
- **Maps/Sets:** Standard methods (`set`, `get`, `has`, `delete`, `add`)
- **Regex:** `test()`, `exec()`

**Built-in APIs:**
- **Console:** `console.log()`
- **Process:** `process.exit()`, `process.argv`
- **File System:** `fs.readFileSync()`, `fs.writeFileSync()`, `fs.unlinkSync()`
- **Path:** `path.resolve()`, `path.dirname()`
- **Network (POSIX):** `socket()`, `bind()`, `listen()`, `accept()`, `connect()`, `read()`, `write()`, `close()`
- **HTTP:** `fetch()` for simple GET requests
- **JSON:** `JSON.parse<T>()` with TypeScript interface type checking
- **Memory:** `malloc()`, `free()`

## Limitations

**Integer-only:** No floats yet. `150 / 100 = 1` (truncates). Use fixed-point math for decimals.

**No npm packages:** Can't use Node modules - they depend on V8 runtime. Built-in APIs only.

**No dynamic features:** No `eval`, `typeof`, `Object.keys()`, destructuring, spread, optional chaining.

**No async/await:** Synchronous only. No event loop, no Promises.

**No reflection:** No `instanceof`, `for..in`, runtime type inspection.

## Compiler Usage

```bash
chadscript [options] <input.ts|.js> [output]

Options:
  -v, --verbose    Show compilation steps
  -h, --help       Show help

Examples:
  chadscript hello.ts           # Compile (silent)
  chadscript -v hello.ts        # Verbose output
  chadscript hello.ts my-cli    # Custom output name
```

## Architecture

```
TypeScript → JS (strip types) → AST (parser) → LLVM IR (codegen) → native binary (llc + clang)
```

**Code:** ~1,300 lines total. Parser: 220 lines, codegen: 130 lines core + specialized generators.

**Tests:** 53 passing (core language, network, LLVM IR validation)

## Type System

| TypeScript | LLVM | Size |
|-----------|------|------|
| `number` | `i32` | 4B |
| `string` | `i8*` | 8B |
| `boolean` | `i32` | 4B |
| `Array<T>`, `Map<K,V>`, `Set<T>` | pointer | 8B |
| Interface | `struct*` | packed |

## Known Limitations

**Nested if returns:** Deep nesting with early returns can generate invalid IR. Workaround: extract to separate functions.

**Type tracking:** Objects returned from functions may lose type info. Workaround: return primitives.

**Memory writes:** No direct memory write operations yet (`poke8/16/32`).

## Roadmap

**Phase 2 Complete ✅:** Interfaces, networking, classes, try/catch, 53/53 tests passing

**Phase 3 (Next):** Floats (`f32`/`f64`), memory write ops, HTTP parser, FFI, SIMD, optimizations, self-hosting

## Performance Comparison

| Metric | ChadScript | Node.js | Difference |
|--------|-----------|---------|------------|
| Startup time | <1ms | 50-200ms | **200x faster** |
| Binary size | 15-30KB | 50MB+ | **1000x smaller** |
| Memory usage | ~1MB | ~50MB | **50x less** |
| Runtime overhead | None | V8 JIT | **Zero overhead** |

## Contributing

Experimental and educational project. Perfect for learning about compilers, LLVM, and AOT compilation.

**License:** MIT
