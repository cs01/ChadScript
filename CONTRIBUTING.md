# Contributing to ChadScript

## Setup

```bash
npm install
npm run build
npm test
```

**Prerequisites:** Node.js 18+, LLVM 14+, Clang

## Development Commands

```bash
npm run typecheck      # Fast type check (no emit)
npm run check          # Types + tests
npm run test:fast      # Quick smoke tests
npm test               # Full test suite
```

## Adding a New Method

1. **Add handler** in the appropriate generator (e.g., `src/codegen/types/collections/string.ts`)
2. **Route it** in `src/codegen/expressions/method-calls.ts`
3. **Add extern** if calling C runtime (in `llvm-generator.ts`)
4. **Add test** in `tests/fixtures/<category>/`

Example test fixture (`tests/fixtures/strings/string-endswith.js`):
```javascript
function test() {
  const s = "hello.ts";
  if (s.endsWith(".ts")) return 1;
  return 0;
}
process.exit(test());
```

## Adding a New AST Node

1. Define in `src/ast/types.ts`
2. Parse in `src/parser/parser.ts`
3. Generate in `src/codegen/`
4. Add tests

## Commit Style

```
feat: add string.endsWith method
fix: handle empty arrays in map()
refactor: extract type resolver to separate file
```

One logical change per commit. All tests passing before commit.

## Testing a Single Fixture

```bash
npx tsx src/index.ts tests/fixtures/strings/string-endswith.js
./tests/fixtures/strings/string-endswith
echo $?  # Check exit code
```
