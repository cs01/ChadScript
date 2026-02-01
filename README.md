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
import { add } from './math.js';
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

### HTTP Server (Express-like API)

**Build native HTTP servers with a familiar routing pattern:**

```typescript
interface Request {
  method: string;
  path: string;
  body: string;
  contentType: string;
}

interface Response {
  status: number;
  body: string;
}

function handleRequest(req: Request): Response {
  if (req.path == "/") {
    return { status: 200, body: "Hello from ChadScript!" };
  }
  if (req.path == "/json") {
    return { status: 200, body: '{"message":"hello","count":42}' };
  }
  if (req.method == "POST" && req.path == "/echo") {
    return { status: 200, body: req.body };
  }
  return { status: 404, body: "Not Found" };
}

httpServe(3000, handleRequest);
```

Compiles to a native binary. Uses mongoose embedded server under the hood.

See `examples/http-handler.ts` for a complete example.

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

See `/examples/` for more working examples: CLI tools (`hello.ts`, `word-count.ts`), network servers (`tcp-server.ts`, `simple-http-server.ts`), and more.

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
- **HTTP Client:** `fetch()` for GET/POST requests (returns Promise)
- **HTTP Server:** `httpServe(port, handler)` with Request/Response objects
- **JSON:** `JSON.parse<T>()` with TypeScript interface type checking
- **Async:** `async/await`, `Promise.all()`, `setTimeout`, `setInterval`
- **Memory:** `malloc()`, `free()`

## Limitations

**No npm packages:** Can't use Node modules - they depend on V8 runtime. Built-in APIs only.

**No dynamic features:** No `eval`, `typeof`, `Object.keys()`, destructuring, spread, optional chaining.

**Async support:** `async/await`, Promises, and `Promise.all()` for parallel operations. Event loop via libuv for `setTimeout`/`setInterval`.

**No reflection:** No `instanceof`, `for..in`, runtime type inspection.

## Compiler Usage

```bash
chadscript [options] <input.ts|.js> [output]

Options:
  -v, --verbose    Show compilation steps
  --debug          Show internal debugging information
  --trace          Show everything (AST, IR, variable tracking)
  -h, --help       Show help

Examples:
  chadscript hello.ts           # Compile (silent on success)
  chadscript -v hello.ts        # Verbose output (compilation stages)
  chadscript --debug hello.ts   # Debug output (for compiler development)
  chadscript hello.ts my-cli    # Custom output name
```

**For AI agents/developers:** Use `--debug` or `--trace` when you need detailed compiler output for debugging or understanding compilation issues.

## Autonomous Agent Development

ChadScript includes an **autonomous debugging loop** that uses Claude AI to iteratively fix compiler bugs. Perfect for overnight development sessions where the agent continuously compiles, tests, diagnoses failures, and applies fixes.

### Running the Agent Loop

```bash
# Terminal 1: Start the autonomous agent
npm run agent-loop

# Terminal 2: Monitor progress in real-time
./scripts/monitor.sh
```

### Monitor Dashboard

The monitor script shows a beautiful, non-flashing dashboard:

```
═══════════════════════════════════════════════════════════════
           ChadScript Autonomous Agent Monitor
═══════════════════════════════════════════════════════════════

📊 DASHBOARD
────────────────────────────────────────
  Status:      running  |  Iteration: 5
  Elapsed:     12 minutes
  CLI Tests:   7/10
  HTTP Tests:  0/5
  Fixes:       3/5 successful
  Updated:     2026-01-30T19:45:00.000Z

🤖 CLAUDE STATUS
────────────────────────────────────────
  State:   fixing
  Task:    Applying fix...
  File:    src/codegen/expressions/index-access.ts

🔧 CURRENT ERROR
────────────────────────────────────────
  Fix this ChadScript compiler error:
  Category: llvm-ir
  Error: type mismatch in phi node...

📜 RECENT LOGS
────────────────────────────────────────
  [timestamp] CLI compilation succeeded!
  [timestamp] Running test 7/10...
```

### Agent Loop Options

```bash
# Run with custom settings
npm run agent-loop -- --max-iterations 50 --timeout 14400

# Dry run (no actual fixes, just diagnosis)
npm run agent-loop -- --dry-run

# Options:
#   --max-iterations N   Stop after N iterations (default: 100)
#   --timeout N          Stop after N seconds (default: 28800 = 8 hours)
#   --dry-run            Diagnose but don't call Claude to fix
```

### State Files

The agent loop maintains state in `agent-state/`:

| File | Description |
|------|-------------|
| `dashboard.json` | Current status (iteration, test counts, etc.) |
| `claude-status.json` | What Claude is currently doing |
| `current-error.txt` | The error being fixed |
| `last-claude-command.txt` | Exact command sent to Claude |
| `fix-history.json` | All attempted fixes and outcomes |
| `checkpoint-N.json` | Periodic snapshots for recovery |

### How It Works

1. **Compile** test programs (`cli-program.ts`, `http-program.ts`)
2. **Diagnose** failures (LLVM IR errors, segfaults, wrong output)
3. **Call Claude** with detailed error context
4. **Claude fixes** the compiler source code
5. **Re-test** and repeat until all tests pass

The agent automatically handles crash recovery and checkpointing.

## Architecture

```
TypeScript → JS (strip types) → AST (parser) → LLVM IR (codegen) → native binary (llc + clang)
```

**Code:** ~1,300 lines total. Parser: 220 lines, codegen: 130 lines core + specialized generators.

**Tests:** 53 passing (core language, network, LLVM IR validation)

## Type System

| TypeScript | LLVM | Size |
|-----------|------|------|
| `number` | `double` | 8B |
| `string` | `i8*` | 8B |
| `boolean` | `double` | 8B |
| `Array<T>`, `Map<K,V>`, `Set<T>` | pointer | 8B |
| Interface | `struct*` | packed |

### Type System Characteristics

| Property | What it means |
|----------|---------------|
| **Static** | Types checked at compile time, not runtime |
| **Strong** | No silent type coercion (unlike JavaScript's `"5" - 3 = 2`) |
| **Structural** | Interfaces match by shape, not by name |
| **Inferred** | Compiler figures out types without explicit annotations |
| **Monomorphized** | Generics generate specialized code per type (fast!) |

ChadScript prioritizes **soundness over completeness**: if it compiles, the types are correct at runtime. Not all valid TypeScript programs compile yet, but the ones that do won't have type errors.

## Known Limitations

**Nested if returns:** Deep nesting with early returns can generate invalid IR. Workaround: extract to separate functions.

**Type tracking:** Objects returned from functions may lose type info. Workaround: return primitives.

**Memory writes:** No direct memory write operations yet (`poke8/16/32`).

## Roadmap

**Phase 2 Complete ✅:** Interfaces, networking, classes, try/catch, async/await, HTTP server

**Phase 3 (Current):** Self-hosting (compile ChadScript with ChadScript)

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
