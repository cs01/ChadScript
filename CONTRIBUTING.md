# Contributing to ChadScript

Thank you for your interest in contributing to ChadScript! This guide will help you get started with development, understand our conventions, and successfully contribute to the project.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [How to Add Features](#how-to-add-features)
- [Code Style and Conventions](#code-style-and-conventions)
- [Testing Guidelines](#testing-guidelines)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)
- [Common Tasks](#common-tasks)

---

## Getting Started

### Prerequisites

- **Node.js** 18+ and npm
- **LLVM** 14+ (for `llc` command)
- **Clang** or GCC (for linking)
- **Git** for version control

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/chadscript.git
cd chadscript

# Install dependencies
npm install

# Build the compiler
npm run build

# Run tests to verify setup
npm test
```

### Repository Structure

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed architecture documentation.

**Key directories**:
- `src/` - TypeScript source code
- `tests/` - Test suite and fixtures
- `examples/` - Example programs
- `lib/` - Standard library (bundled with programs)

---

## Development Workflow

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
```

### 2. Make Changes

Edit source files in `src/`. The compiler is written in TypeScript.

### 3. Build and Test

```bash
# Build the compiler
npm run build

# Run all tests
npm test

# Run specific test
node --import tsx --test --test-reporter=spec --test-name-pattern="array-map" tests/compiler.test.ts

# Test a single fixture manually
npx tsx src/index.ts tests/fixtures/arithmetic/simple-add.js
./tests/fixtures/arithmetic/simple-add
echo $?  # Should print 12
```

### 4. Commit and Push

```bash
git add .
git commit -m "feat: add array.reduce() method"
git push origin feature/your-feature-name
```

### 5. Open Pull Request

Open a PR on GitHub with a clear description of your changes.

---

## How to Add Features

### Adding a New Built-in Function

**Example**: Adding `Math.floor()`

#### Step 1: Declare the External Function

In `src/codegen/llvm-generator.ts`, add to `declareExternalFunctions()`:

```typescript
private declareExternalFunctions() {
  // ... existing declarations
  this.output.push('declare double @floor(double)');
}
```

#### Step 2: Handle in Code Generation

In `generateCall()` or `generateMemberAccess()`:

```typescript
// In generateCall() for Math.floor()
if (expr.callee.type === 'member_access') {
  const memberExpr = expr.callee as any;

  if (memberExpr.object.name === 'Math' && memberExpr.property === 'floor') {
    const argReg = this.generateExpression(expr.arguments[0], params);
    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = call double @floor(double ${argReg})`);
    return resultReg;
  }
}
```

#### Step 3: Add Test Fixture

Create `tests/fixtures/arithmetic/math-floor.js`:

```javascript
function test() {
  return Math.floor(3.7);
}

process.exit(test());
```

#### Step 4: Add Test Case

In `tests/compiler.test.ts`:

```typescript
{
  name: 'math-floor',
  fixture: 'tests/fixtures/arithmetic/math-floor.js',
  expectedExitCode: 3,
  description: 'Math.floor() should round down'
}
```

#### Step 5: Test and Commit

```bash
npm run build
npm test
git add -A
git commit -m "feat: add Math.floor() built-in function"
```

---

### Adding a New Array Method

**Example**: Adding `Array.reduce()`

#### Step 1: Add to Array Generator

In `src/codegen/generators/array-generator.ts`:

```typescript
generateArrayReduce(expr: CallNode, object: Expression, params: string[]): string {
  // 1. Get array pointer
  const arrayReg = this.generateExpression(object, params);

  // 2. Get callback function
  const callbackReg = this.generateExpression(expr.arguments[0], params);

  // 3. Get initial value
  const initialReg = this.generateExpression(expr.arguments[1], params);

  // 4. Generate loop that accumulates values
  // ... (see array-generator.ts for similar patterns)

  return resultReg;
}
```

#### Step 2: Wire Up in Main Generator

In `src/codegen/llvm-generator.ts`, add to method dispatch:

```typescript
if (method === 'reduce') {
  return this.arrayGen.generateArrayReduce(expr, object, params);
}
```

#### Step 3: Add Test

Create `tests/fixtures/arrays/array-reduce.js`:

```javascript
const arr = [1, 2, 3, 4];
const sum = arr.reduce((acc, val) => acc + val, 0);
process.exit(sum); // Should be 10
```

Add test case to `tests/compiler.test.ts`.

---

### Adding a New AST Node Type

**Example**: Adding a `do-while` loop

#### Step 1: Define AST Node

In `src/ast/types.ts`:

```typescript
export interface DoWhileStatement {
  type: 'do_while';
  condition: Expression;
  body: BlockStatement;
}

// Add to Statement union
export type Statement =
  | VariableDeclaration
  | DoWhileStatement  // Add here
  | ...;
```

#### Step 2: Parse It

In `src/parser/parser.ts`:

```typescript
private parseStatement(): Statement {
  // ... existing cases

  if (this.match('do')) {
    return this.parseDoWhileStatement();
  }

  // ...
}

private parseDoWhileStatement(): DoWhileStatement {
  this.expect('do');
  const body = this.parseBlock();
  this.expect('while');
  this.expect('(');
  const condition = this.parseExpression();
  this.expect(')');
  this.expect(';');

  return {
    type: 'do_while',
    condition,
    body
  };
}
```

#### Step 3: Generate Code

In `src/codegen/llvm-generator.ts` (or control-flow-generator.ts):

```typescript
private generateStatement(stmt: Statement, params: string[]): void {
  // ... existing cases

  if (stmt.type === 'do_while') {
    this.generateDoWhileStatement(stmt, params);
    return;
  }

  // ...
}

private generateDoWhileStatement(stmt: DoWhileStatement, params: string[]): void {
  const loopLabel = this.nextLabel();
  const condLabel = this.nextLabel();
  const endLabel = this.nextLabel();

  // Loop body (executes at least once)
  this.emit(`br label %${loopLabel}`);
  this.emit(`${loopLabel}:`);
  this.generateBlock(stmt.body, params);

  // Condition check
  this.emit(`br label %${condLabel}`);
  this.emit(`${condLabel}:`);
  const condReg = this.generateExpression(stmt.condition, params);
  const condBoolReg = this.nextTemp();
  this.emit(`${condBoolReg} = fcmp une double ${condReg}, 0.0`);
  this.emit(`br i1 ${condBoolReg}, label %${loopLabel}, label %${endLabel}`);

  this.emit(`${endLabel}:`);
}
```

#### Step 4: Add Tests

Create fixture and test case as shown above.

---

### Adding a New Data Structure

**Example**: Adding a `Queue` type

#### Step 1: Create Generator

Create `src/codegen/generators/queue-generator.ts`:

```typescript
import { BaseGenerator } from './base-generator.js';
import { CallNode, Expression } from '../../ast/types.js';

export class QueueGenerator extends BaseGenerator {
  generateExpression!: (expr: Expression, params: string[]) => string;

  generateQueueNew(): string {
    // Allocate Queue struct
    // Return pointer
  }

  generateQueueEnqueue(expr: CallNode, object: Expression, params: string[]): string {
    // Add element to back of queue
  }

  generateQueueDequeue(expr: CallNode, object: Expression, params: string[]): string {
    // Remove element from front
  }
}
```

#### Step 2: Integrate in Main Generator

In `src/codegen/llvm-generator.ts`:

```typescript
import { QueueGenerator } from './generators/queue-generator.js';

export class LLVMGenerator {
  private queueGen: QueueGenerator;

  constructor(ast: AST, typeChecker: TypeChecker | null) {
    // ... existing generators

    this.queueGen = new QueueGenerator();
    this.queueGen.generateExpression = this.generateExpression.bind(this);
  }

  // In generateMethodCall():
  if (method === 'enqueue') {
    return this.queueGen.generateQueueEnqueue(expr, object, params);
  }
}
```

#### Step 3: Define Queue Struct

In `declareStructTypes()`:

```typescript
private declareStructTypes() {
  // ... existing structs

  this.output.push(`
%Queue = type {
  i32,        ; front index
  i32,        ; back index
  i32,        ; capacity
  double*     ; data pointer
}
  `.trim());
}
```

#### Step 4: Add Tests and Documentation

---

## Code Style and Conventions

### TypeScript Style

**Follow existing patterns**:

```typescript
// Use explicit types for function signatures
function generateExpression(expr: Expression, params: string[]): string {
  // ...
}

// Use private for internal methods
private nextTemp(): string {
  return `%${this.tempCounter++}`;
}

// Use interface for complex types
interface SymbolInfo {
  name: string;
  llvmType: string;
  kind: 'primitive' | 'array' | 'object';
}
```

### Naming Conventions

- **Classes**: PascalCase (`LLVMGenerator`, `Parser`, `TypeChecker`)
- **Functions**: camelCase (`generateExpression`, `parseStatement`)
- **Variables**: camelCase (`tempCounter`, `outputFile`)
- **Constants**: camelCase (`LogLevel.Verbose`)
- **Files**: kebab-case (`llvm-generator.ts`, `array-generator.ts`)
- **AST Nodes**: PascalCase with `Node` suffix (`BinaryNode`, `CallNode`)

### Code Organization

- **One class per file** (except small utility classes)
- **Alphabetize imports**
- **Group related methods** with comment headers:

```typescript
// ============================================
// EXPRESSION GENERATION
// ============================================

private generateExpression(...) { }
private generateBinary(...) { }
private generateCall(...) { }

// ============================================
// STATEMENT GENERATION
// ============================================

private generateStatement(...) { }
private generateIf(...) { }
```

### Comments

- **Use JSDoc for public APIs**:

```typescript
/**
 * Generates LLVM IR for array map operations
 *
 * @example
 * Input:  [1, 2, 3].map(x => x * 2)
 * Output: LLVM IR that creates new array [2, 4, 6]
 *
 * @param expr - The CallExpression node
 * @param object - Register containing the array
 * @param params - Function parameters
 * @returns Register containing the new array
 */
generateArrayMap(expr: CallNode, object: Expression, params: string[]): string {
  // ...
}
```

- **Inline comments for complex logic**:

```typescript
// Convert JavaScript boolean to LLVM i1 (0.0 = false, non-zero = true)
const condBoolReg = this.nextTemp();
this.emit(`${condBoolReg} = fcmp une double ${condReg}, 0.0`);
```

---

## Testing Guidelines

### Test Requirements

**Every feature must have**:
1. **At least one fixture** in `tests/fixtures/`
2. **At least one test case** in `tests/compiler.test.ts`
3. **All existing tests must pass**

### Writing Test Fixtures

**Location**: Place in appropriate subdirectory under `tests/fixtures/`:
- `arithmetic/` - Math operations
- `arrays/` - Array operations
- `strings/` - String operations
- `control-flow/` - Conditionals and loops
- etc. (see `tests/fixtures/README.md`)

**Naming**: Use descriptive names like `array-reduce.js`, `math-floor.js`

**Format**: Use exit code to indicate result:

```javascript
// tests/fixtures/arrays/array-reduce.js
const arr = [1, 2, 3, 4, 5];
const sum = arr.reduce((acc, val) => acc + val, 0);
process.exit(sum); // Exit code = 15
```

### Writing Test Cases

In `tests/compiler.test.ts`:

```typescript
const testCases: TestCase[] = [
  // ... existing tests
  {
    name: 'array-reduce',
    fixture: 'tests/fixtures/arrays/array-reduce.js',
    expectedExitCode: 15,
    description: 'Array .reduce() should sum array elements'
  }
];
```

### Running Tests

```bash
# Run all tests
npm test

# Run specific test by name
node --import tsx --test --test-reporter=spec --test-name-pattern="array-reduce" tests/compiler.test.ts

# Run all array tests
node --import tsx --test --test-reporter=spec --test-name-pattern="Array" tests/compiler.test.ts

# Debug a failing test
npx tsx src/index.ts tests/fixtures/arrays/array-reduce.js --verbose
cat tests/fixtures/arrays/array-reduce.ll  # Inspect generated IR
./tests/fixtures/arrays/array-reduce
echo $?  # Check exit code
```

### Test Coverage

Aim for tests that cover:
- **Happy path**: Normal usage
- **Edge cases**: Empty arrays, null values, etc.
- **Error cases**: Type mismatches, undefined variables
- **Integration**: Features working together

---

## Commit Messages

### Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code restructuring (no behavior change)
- `docs`: Documentation only
- `test`: Adding or updating tests
- `perf`: Performance improvement
- `chore`: Tooling, dependencies, etc.

### Examples

```
feat(codegen): add Math.floor() built-in function

- Added floor() declaration to external functions
- Implemented code generation for Math.floor() calls
- Added test fixture and test case

Closes #42
```

```
fix(parser): handle empty array literals correctly

Previously, parsing [] would fail with a syntax error.
Now properly generates an empty array AST node.

Fixes #123
```

```
refactor(llvm-generator): extract array methods to dedicated generator

- Created ArrayGenerator class with all array method implementations
- Reduced main generator from 3,787 to 2,500 lines
- All 52 tests passing
```

### Commit Hygiene

- **One logical change per commit**
- **All tests passing** before committing
- **Descriptive commit messages** (explain why, not just what)
- **No unrelated changes** in the same commit

---

## Pull Request Process

### Before Submitting

1. ✅ **All tests pass**: `npm test`
2. ✅ **Code builds**: `npm run build`
3. ✅ **No lint errors**: Fix any TypeScript errors
4. ✅ **Added tests**: For new features
5. ✅ **Updated docs**: If changing public APIs

### PR Template

```markdown
## Description
Brief description of the change.

## Motivation
Why is this change needed? What problem does it solve?

## Changes
- Added X
- Modified Y
- Removed Z

## Testing
How was this tested? Which test cases were added?

## Checklist
- [ ] Tests added and passing
- [ ] Documentation updated
- [ ] No breaking changes (or clearly documented)
- [ ] Follows code style guidelines
```

### Review Process

1. **Automated checks** run (tests, build)
2. **Maintainer review** (usually within 1-2 days)
3. **Address feedback** if requested
4. **Merge** once approved

---

## Common Tasks

### Adding a String Method

1. Add to `src/codegen/generators/string-generator.ts`
2. Wire up in `llvm-generator.ts` method dispatch
3. Add test in `tests/fixtures/strings/`
4. Add test case in `compiler.test.ts`

### Adding a Parser Feature

1. Update `src/ast/types.ts` with new node type
2. Add parsing logic in `src/parser/parser.ts`
3. Add code generation in `src/codegen/llvm-generator.ts`
4. Add tests

### Fixing a Bug

1. **Reproduce**: Write a failing test case first
2. **Fix**: Modify source code
3. **Verify**: Ensure test now passes
4. **Commit**: Include the test in your commit

### Improving Error Messages

1. Modify `formatError()` in `parser.ts`
2. Add context, suggestions, or notes
3. Test manually with invalid input
4. Commit with example in commit message

### Performance Optimization

1. **Measure first**: Establish baseline (compile time, binary size, runtime)
2. **Optimize**: Make changes
3. **Measure again**: Verify improvement
4. **Add benchmark**: Prevent regression

---

## Getting Help

- **Architecture questions**: See [ARCHITECTURE.md](ARCHITECTURE.md)
- **Test organization**: See [tests/fixtures/README.md](tests/fixtures/README.md)
- **Issues**: Check existing issues on GitHub
- **Discussions**: Start a discussion for design questions

---

## Code of Conduct

Be respectful, inclusive, and constructive in all interactions.

---

## License

By contributing, you agree that your contributions will be licensed under the same license as the project (see LICENSE file).

---

**Thank you for contributing to ChadScript!** 🚀

Your contributions help make AOT TypeScript compilation a reality.
