# Test Fixtures

> **Most directories here are untriaged v1 salvage.** Their presence does not mean v2 supports
> the feature. Current accepted behavior is exercised by differential fixtures in `run/`; current
> compile-time rejection fixtures live in `reject/`. See `PLAN.md` and
> `docs/architecture-review-2026-07-22.md` before promoting an old fixture.

The remainder of this file documents the historical v1 fixture layout and harness. Do not use it
as the v2 support contract or as current instructions for adding tests.

## Directory Structure

```
fixtures/
├── arithmetic/          # Basic arithmetic operations and math functions
├── arrays/              # Array literals, indexing, and methods (map, filter, etc.)
├── bitwise/             # Bitwise operations (AND, OR, XOR, shifts)
├── builtins/            # Built-in functions (console.log, process.argv, fs, JSON)
├── classes/             # Object-oriented programming (constructors, methods, inheritance)
├── comparisons/         # Comparison operators (==, ===, !=, !==, <, >, etc.)
├── control-flow/        # Conditionals (if/else, ternary) and loops (while, for, break, continue)
├── data-structures/     # Map and Set data structures
├── debugging/           # Debug fixtures for development
├── edge-cases/          # Edge cases and special scenarios
├── error-handling/      # Try/catch/throw error handling
├── functions/           # Function expressions and advanced function features
├── imports-exports/     # Multi-file compilation with imports/exports
├── logical/             # Logical operators (&&, ||, !)
├── network/             # Network operations (TCP, HTTP)
├── objects/             # Object literals and property access
├── regex/               # Regular expressions
├── strings/             # String operations and methods
└── typescript/          # TypeScript-specific features
```

## Naming Conventions

Test fixtures follow these naming patterns:

- **Simple operations**: `simple-add.js`, `simple-multiply.js`
- **Feature tests**: `array-filter.js`, `string-concat.js`, `class-basic.js`
- **Method tests**: Named after the method being tested (e.g., `array-push.js`, `string-repeat.js`)
- **Complex scenarios**: Descriptive names like `operator-precedence.js`, `nested-calls.js`

## Adding New Test Fixtures

When adding a new test fixture:

1. **Choose the appropriate category** - Place the file in the subdirectory that best matches its primary feature
2. **Use descriptive names** - The filename should clearly indicate what's being tested
3. **Follow existing patterns** - Look at similar tests in the category for naming guidance
4. **Add to test suite** - Update `tests/compiler.test.ts` with a new test case

### Example:

```javascript
// To add a test for array .reduce() method:
// 1. Create tests/fixtures/arrays/array-reduce.js
// 2. Add test case to compiler.test.ts:

{
  name: 'array-reduce',
  fixture: 'tests/fixtures/arrays/array-reduce.js',
  expectedExitCode: 15, // Expected result
  description: 'Array .reduce() should sum array elements'
}
```

## Test Execution

Tests compile each fixture to a native executable and verify:

- **Compilation succeeds** - LLVM IR and executable are generated
- **Exit code matches** - The program returns the expected exit code
- **Output is correct** (for some tests) - stdout/stderr match expectations

Compiled artifacts (.ll files and executables) are created in the same directory as the source fixture and cleaned up after each test.

## Categories Explained

### arithmetic/

Tests for mathematical operations:

- Basic arithmetic: add, subtract, multiply, divide, modulo
- Operator precedence
- Nested function calls
- Math built-in functions (sqrt, pow, floor, ceil, etc.)

### arrays/

Tests for array operations:

- Array literals and indexing
- Array methods: map, filter, reduce, find, some, forEach, push, pop, includes
- String arrays (arrays of strings have a different internal representation)
- Array initialization and safety

### strings/

Tests for string operations:

- String literals and concatenation
- String methods: length, substr, substring, concat, repeat, padStart, split, trim, charAt, indexOf
- String indexing (returns character code)

### control-flow/

Tests for program control structures:

- Conditional statements: if, if-else, nested conditionals
- Ternary operator
- Loops: while, for
- Loop control: break, continue

### classes/

Tests for object-oriented programming:

- Class declarations with constructors
- Methods and this binding
- Inheritance and super
- Class fields with type annotations

### objects/

Tests for object literals:

- Object creation and property access
- Nested objects
- Object methods
- Dynamic property access

### data-structures/

Tests for built-in data structures beyond arrays:

- Map: set, get, has, delete, size
- Set: add, has, delete, size

### comparisons/ & logical/

Tests for boolean operations:

- Comparison operators: ==, ===, !=, !==, <, >, <=, >=
- Logical operators: &&, ||, !
- Boolean literals: true, false

### bitwise/

Tests for bitwise operations:

- AND, OR, XOR
- Left shift, right shift
- Bitwise NOT

### builtins/

Tests for built-in functions and APIs:

- console.log
- process.argv and command-line arguments
- fs.readFileSync
- JSON.parse and JSON.stringify
- parseInt, parseFloat

### functions/

Tests for advanced function features:

- Function expressions
- Arrow functions
- Anonymous functions
- Higher-order functions

### imports-exports/

Tests for multi-file compilation:

- ES6 import/export syntax
- Relative imports
- Cross-file function calls

### error-handling/

Tests for exception handling:

- try/catch/throw
- Error propagation

### network/

Tests for network operations:

- TCP servers and clients
- HTTP requests (fetch API)

### regex/

Tests for regular expressions:

- Pattern matching
- String replacement
- regex.test()

### typescript/

Tests for TypeScript-specific features:

- Type annotations
- Interfaces
- Generic types

### edge-cases/

Tests for special scenarios:

- Empty strings and arrays
- Shebang handling
- Bootstrap scenarios
- Local variable scoping

### debugging/

Development fixtures used for debugging compiler issues. These may not have corresponding test cases in the test suite.

## File Types

- **`.js`** - JavaScript source files (most common)
- **`.ts`** - TypeScript source files (for type annotation tests)
- **`.ll`** - LLVM IR output (generated during compilation, cleaned up after tests)
- **(no extension)** - Compiled native executables (generated, cleaned up after tests)

## Best Practices

1. **Keep fixtures minimal** - Test one feature at a time
2. **Use meaningful exit codes** - The exit code should reflect the test result
3. **Document expectations** - Add comments explaining what the test verifies
4. **Avoid dependencies** - Each fixture should be self-contained (except for imports-exports/)
5. **Clean up after yourself** - Build artifacts are automatically cleaned up by the test harness
