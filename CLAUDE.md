# ChadScript v2

## What It Is

TypeScript-to-native compiler. Compiles .ts files to native binaries via: SWC parse → HIR → Transform passes → LLVM C API → clang link → binary.

Key innovation: **unboxed-first with NaN-boxing escape hatch.** Statically-typed values stay as raw f64/i32/i8*. Dynamic types (`any`, unions) get NaN-boxed. Integer narrowing pass narrows `number` to `i32` when provably integer-valued.

## Architecture

```
src/
  parser.ts          — SWC wrapper → ChadScript AST
  hir/
    types.ts         — HIR node definitions
    lower.ts         — AST → HIR lowering
  transforms/        — HIR → HIR passes (integer narrowing, box insertion, closures, async)
  codegen/
    llvm-bridge.c    — C bridge wrapping LLVM C API
    emitter.ts       — HIR → LLVM via C bridge
  compiler.ts        — orchestrator
tests/fixtures/      — test programs (Node-compatible .ts files)
c_bridges/           — C runtime helpers (regex, json, net, etc.)
```

## Build & Test

```bash
npm run build        # TypeScript → dist/
npm test             # run test fixtures
chad2 build file.ts -o out   # compile a TS file to native binary
```

## Code Style

- No comments unless the WHY is non-obvious
- Discriminated dispatch: `switch` + `throw` on default, never silent fallthrough
- Prettier auto-formats: `npm run format`

## Plan

Full rewrite roadmap: see `.claude/plans/scalable-forging-castle.md`
