# ChadScript v2

TypeScript, compiled to native code.

ChadScript compiles TypeScript to native machine code via LLVM. No VM, no interpreter. The output is a standalone binary.

**Status: Alpha** — active rewrite. 50 parity tests passing.

## Architecture

```
TS source → SWC parse → HIR → LLVM C API → clang link → native binary
```

Key innovation: **unboxed-first with NaN-boxing escape hatch.** Statically-typed values stay as raw `f64`/`i64`/`i8*`. Dynamic types get NaN-boxed. Integer narrowing pass narrows `number` to `i64` when provably integer-valued.

## Build & Test

```bash
brew install llvm              # macOS
npm install
npm test                       # compiles each fixture, diffs output against node
```

## Usage

```bash
npx tsx src/cli.ts build hello.ts -o hello
./hello
```

## What Works

- Functions, closures, higher-order functions
- Numbers (f64 + i64 integer narrowing), booleans, strings
- Arrays, classes, inheritance, interfaces
- Control flow (if/else, for, while, do-while, switch, for-of, break/continue)
- Template literals, ternary, compound assignment
- Math built-ins, string methods, array methods

See `tests/fixtures/` for the full set of working programs.

## License

MIT
