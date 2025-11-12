# Agent Notes

## Running Tests

```bash
# All tests
npm test

# Single test file with verbose output
node --import tsx --test --test-reporter=spec tests/compiler.test.ts

# Specific test by name pattern
node --import tsx --test --test-reporter=spec --test-name-pattern="Simple addition" tests/compiler.test.ts
```

## Compiler Verbose Output

```bash
# Run compiler with verbose output
npx tsx src/index.ts --verbose input.js

# Run compiler with trace output
npx tsx src/index.ts --trace input.js
```

## Current Test Status

Tests are failing with `ERR_ASSERTION` - the compiler/executable is not running correctly. Need to investigate why compilation or execution is failing.
