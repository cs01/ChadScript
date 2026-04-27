# ChadScript v2

## What It Is

TypeScript-to-native compiler. Compiles .ts files to native binaries via: SWC parse → HIR → LLVM C API → clang link → binary.

Key innovation: **unboxed-first with NaN-boxing escape hatch.** Statically-typed values stay as raw f64/i64/i8*. Dynamic types (`any`, unions) get NaN-boxed. Integer narrowing pass narrows `number` to i64 when provably integer-valued.

## Architecture

```
src/
  parser.ts          — SWC wrapper → SWC AST
  hir/
    types.ts         — HIR node definitions
    lower.ts         — SWC AST → HIR lowering
  codegen/
    llvm.ts          — koffi FFI wrapper for LLVM C API
    emitter.ts       — HIR → LLVM via C API
  compiler.ts        — orchestrator: parse → lower → emit → link
  cli.ts             — CLI entry point
  errors.ts          — diagnostic engine
tests/
  compiler.test.ts   — auto-discovers fixtures, compiles, diffs output against node
  fixtures/          — .ts test programs (stdout parity against node)
  fixtures/errors/   — expected compile errors
c_bridges/
  v2-string-bridge.c — string runtime helpers
  v2-array-bridge.c  — array runtime helpers
```

## Build & Test

```bash
npm install
npm test             # compiles each fixture, runs it, diffs stdout against node
npx tsx src/cli.ts build file.ts -o out   # compile a single file
```

## Test Fixtures

Tests auto-discover all `.ts` files in `tests/fixtures/`. Each fixture is compiled to a native binary, executed, and its stdout is compared against `node --experimental-strip-types`. No manual test list — just add a `.ts` file and it's picked up.

Error fixtures in `tests/fixtures/errors/` test expected compile errors.

## Code Style

- No comments unless the WHY is non-obvious
- Discriminated dispatch: `switch` + `throw` on default, never silent fallthrough
- Prettier auto-formats: `npm run format`

## Plan

Full rewrite roadmap: see `.claude/plans/scalable-forging-castle.md`
