# ChadScript Architecture

This document provides a comprehensive overview of ChadScript's architecture, design patterns, and implementation details. It's intended for contributors, maintainers, and AI agents working with the codebase.

## Table of Contents

- [Overview](#overview)
- [Project Structure](#project-structure)
- [Compilation Pipeline](#compilation-pipeline)
- [Key Components](#key-components)
- [Design Patterns](#design-patterns)
- [Data Flow](#data-flow)
- [Extension Points](#extension-points)
- [Architecture Decisions](#architecture-decisions)

---

## Overview

**ChadScript** is an ahead-of-time (AOT) TypeScript/JavaScript compiler that compiles directly to native machine code via LLVM. It bypasses the Node.js runtime entirely, producing standalone executables with instant startup times and minimal binary sizes (15-30KB).

### Key Characteristics

- **Language**: Written in TypeScript, targets self-hosting
- **Architecture**: Classic multi-stage compiler pipeline
- **Backend**: LLVM for code generation and optimization
- **Target**: Native executables for x86-64 and ARM64
- **Lines of Code**: ~11,000 lines across ~20 modules

### Design Philosophy

1. **Simplicity**: Straightforward implementation that's easy to understand
2. **Modularity**: Clear separation of concerns with specialized modules
3. **Extensibility**: Well-defined extension points for new features
4. **Performance**: AOT compilation for maximum runtime speed
5. **Standards**: Follows LLVM and C ABI conventions

---

## Project Structure

```
ChadScript/
├── src/                          # TypeScript source code
│   ├── index.ts                  # CLI entry point (60 lines)
│   ├── compiler.ts               # Main compiler driver (205 lines)
│   │
│   ├── ast/                      # Abstract Syntax Tree
│   │   └── types.ts              # AST node type definitions (236 lines)
│   │
│   ├── parser/                   # Frontend: Source → AST
│   │   └── parser.ts             # Recursive descent parser (2,110 lines)
│   │
│   ├── analysis/                 # Semantic analysis
│   │   └── semantic-analyzer.ts  # Type validation (434 lines)
│   │
│   ├── typescript/               # TypeScript integration
│   │   └── type-checker.ts       # TS compiler API wrapper (266 lines)
│   │
│   ├── codegen/                  # Backend: AST → LLVM IR
│   │   ├── llvm-generator.ts     # Main code generator (3,787 lines)
│   │   └── generators/           # Specialized generators
│   │       ├── base-generator.ts        # Shared utilities (103 lines)
│   │       ├── array-generator.ts       # Array operations (1,188 lines)
│   │       ├── string-generator.ts      # String operations (1,019 lines)
│   │       ├── class-generator.ts       # OOP support (418 lines)
│   │       ├── control-flow-generator.ts # Control structures (318 lines)
│   │       ├── map-generator.ts         # Map data structure (301 lines)
│   │       ├── set-generator.ts         # Set data structure (245 lines)
│   │       ├── object-generator.ts      # Object literals (98 lines)
│   │       └── regex-generator.ts       # Regular expressions (93 lines)
│   │
│   ├── runtime/                  # Runtime support
│   │   └── args.ts               # Process args (181 lines)
│   │
│   └── utils/                    # Utilities
│       └── logger.ts             # Logging system (65 lines)
│
├── lib/                          # Standard library (bundled with programs)
│   └── argparse.ts               # CLI argument parsing
│
├── tests/                        # Test suite
│   ├── compiler.test.ts          # Main test suite (52 tests)
│   ├── network.test.ts           # Network tests
│   └── fixtures/                 # Test input files (organized by feature)
│
├── examples/                     # Example programs
│   ├── hello.ts                  # Hello world
│   ├── github-stars.ts           # JSON parsing example
│   └── tcp-server.ts             # Network server
│
└── dist/                         # Compiled JavaScript (from tsc)
```

---

## Compilation Pipeline

ChadScript follows a classic multi-stage compiler architecture:

```
TypeScript/JS Source Code
         ↓
    [1. PARSING]
         ↓
   Abstract Syntax Tree (AST)
         ↓
  [2. SEMANTIC ANALYSIS]
         ↓
   Validated AST + Symbol Table
         ↓
  [3. TYPE CHECKING] (optional)
         ↓
   Type Information
         ↓
  [4. CODE GENERATION]
         ↓
      LLVM IR (.ll file)
         ↓
   [5. LLVM COMPILATION]
         ↓
   Object File (.o)
         ↓
     [6. LINKING]
         ↓
  Native Executable
```

### Stage 1: Parsing

**File**: `src/parser/parser.ts`

- **Input**: JavaScript/TypeScript source code (string)
- **Output**: Abstract Syntax Tree (AST)
- **Method**: Hand-written recursive descent parser
- **Features**:
  - TypeScript type annotation support (strips types)
  - Shebang handling
  - Clang-style error messages with context
  - Infinite loop detection

**Key Functions**:
- `parse()` - Main entry point
- `parseStatement()` - Statement parsing
- `parseExpression()` - Expression parsing with operator precedence
- `formatError()` - Beautiful error messages

### Stage 2: Semantic Analysis

**File**: `src/analysis/semantic-analyzer.ts`

- **Input**: AST
- **Output**: Validated AST + Symbol Table
- **Purpose**: Catch type errors before code generation
- **Validates**:
  - Variable declarations and usage
  - Type compatibility
  - Array homogeneity
  - Function signatures

**Key Methods**:
- `analyze()` - Runs all validation passes
- `getSymbols()` - Returns symbol table for codegen
- `formatErrors()` - Human-readable error output

### Stage 3: Type Checking (Optional)

**File**: `src/typescript/type-checker.ts`

- **Input**: TypeScript source code
- **Output**: Type information for property access
- **Method**: Uses TypeScript compiler API
- **Usage**: Only for `.ts` files, provides type info during codegen

### Stage 4: Code Generation

**File**: `src/codegen/llvm-generator.ts` + `src/codegen/generators/*`

- **Input**: AST + Type Information
- **Output**: LLVM IR (text format)
- **Architecture**: Main generator delegates to specialized generators
- **Responsibilities**:
  - Struct type definitions
  - External function declarations (libc, libcurl, libcjson)
  - Top-level code generation
  - Function lifting (anonymous → named)
  - Variable tracking and type inference

**Delegation Pattern**:
```
LLVMGenerator (orchestrator)
    ↓
    ├─→ ArrayGenerator     (arrays, map, filter, reduce)
    ├─→ StringGenerator    (strings, concat, split, trim)
    ├─→ ClassGenerator     (OOP, constructors, methods)
    ├─→ ControlFlowGenerator (loops, conditionals)
    ├─→ MapGenerator       (Map data structure)
    ├─→ SetGenerator       (Set data structure)
    ├─→ ObjectGenerator    (object literals)
    └─→ RegexGenerator     (regular expressions)
```

### Stage 5: LLVM Compilation

**Tool**: `llc` (LLVM compiler)

- **Input**: LLVM IR (.ll file)
- **Output**: Object file (.o)
- **Command**: `llc -filetype=obj input.ll -o output.o`

### Stage 6: Linking

**Tool**: `clang` or `gcc`

- **Input**: Object file (.o)
- **Output**: Native executable
- **Libraries**: Links against libc, libcurl, libcjson, libm
- **Command**: `clang input.o -o output -no-pie -lcurl -lcjson -lm`

---

## Key Components

### 1. CLI (`src/index.ts`)

**Responsibility**: Command-line interface

- Argument parsing (`-v`, `--debug`, `--trace`)
- Help text display
- Delegates to compiler driver
- Exit code handling

**No compilation logic** - pure UI concerns.

### 2. Compiler Driver (`src/compiler.ts`)

**Responsibility**: Pipeline orchestration

Key functions:
- `compile()` - Main entry point
- `compileMultiFile()` - Recursive import resolution
- `resolveImportPath()` - Maps .js imports to .ts files

**Pipeline Steps**:
1. Detect required build tools (llc, clang/gcc)
2. Parse entry file and follow imports
3. Run semantic analysis
4. Create TypeScript type checker (if .ts file)
5. Generate LLVM IR
6. Compile IR to object file
7. Link to native executable
8. Clean up intermediate files

### 3. Parser (`src/parser/parser.ts`)

**Responsibility**: Lexical + syntax analysis

**Type**: Hand-written recursive descent

**Operator Precedence** (low to high):
1. Logical OR (`||`)
2. Logical AND (`&&`)
3. Bitwise OR (`|`)
4. Bitwise XOR (`^`)
5. Bitwise AND (`&`)
6. Comparison (`==`, `===`, `!=`, `!==`, `<`, `>`, `<=`, `>=`)
7. Shift (`<<`, `>>`)
8. Additive (`+`, `-`)
9. Multiplicative (`*`, `/`, `%`)
10. Unary (`!`, `-`, `typeof`)
11. Primary (literals, identifiers, calls)

**Language Support**:
- Functions, classes, imports/exports
- Variables (`let`/`const`), assignments
- Control flow (if/while/for/try-catch)
- Expressions (binary, unary, ternary, calls)
- Literals (numbers, strings, arrays, objects, regex)

### 4. AST (`src/ast/types.ts`)

**Responsibility**: Type-safe AST node definitions

**Design**: Discriminated unions (tagged unions)

**Node Categories**:
- **Expressions** (18 types): NumberNode, StringNode, BinaryNode, CallNode, etc.
- **Statements** (9 types): VariableDeclaration, IfStatement, WhileStatement, etc.
- **Top-level**: FunctionNode, ClassNode, ImportDeclaration, ExportDeclaration

**Example**:
```typescript
export interface NumberNode {
  type: 'number';
  value: number;
}

export interface BinaryNode {
  type: 'binary';
  op: string;
  left: Expression;
  right: Expression;
}

export type Expression = NumberNode | BinaryNode | ... ;
```

### 5. LLVM Generator (`src/codegen/llvm-generator.ts`)

**Responsibility**: AST → LLVM IR transformation

**Key Responsibilities**:
1. **Type Definitions**: Generates LLVM struct types for arrays, maps, sets, classes
2. **External Declarations**: Declares libc, libcurl, libcjson functions
3. **Function Generation**: Converts JS functions to LLVM functions
4. **Expression Translation**: Maps JS expressions to LLVM instructions
5. **Memory Management**: Generates malloc/free calls for heap allocations

**State Tracking**:
- `variables: Map<string, string>` - Variable name → alloca register
- `variableTypes: Map<string, string>` - Variable name → LLVM type
- `objectVariables: Map<...>` - Object metadata (fields, types)
- `classDefinitions: Map<...>` - Class metadata
- `tempCounter` - Generates unique temp register names
- `labelCounter` - Generates unique label names

**Example Generation**:
```javascript
// Input JS
function add(a, b) {
  return a + b;
}
```

```llvm
; Output LLVM IR
define double @add(double %0, double %1) {
  %3 = fadd double %0, %1
  ret double %3
}
```

### 6. Specialized Generators

Each generator handles one domain:

**Array Generator** (`array-generator.ts`):
- Array literals: `[1, 2, 3]`
- Indexing: `arr[0]`
- Methods: `map`, `filter`, `reduce`, `find`, `some`, `forEach`, `push`, `pop`, `includes`, `indexOf`, `slice`

**String Generator** (`string-generator.ts`):
- String literals: `"hello"`
- Concatenation: `str1 + str2`
- Methods: `length`, `charAt`, `substring`, `indexOf`, `split`, `trim`, `repeat`, `padStart`, `concat`

**Class Generator** (`class-generator.ts`):
- Class declarations
- Constructors
- Methods and `this` binding
- Inheritance and `super`

**Control Flow Generator** (`control-flow-generator.ts`):
- If/else statements
- While/for loops
- Try/catch/throw
- Break/continue

### 7. Logger (`src/utils/logger.ts`)

**Responsibility**: Structured logging

**Levels** (Clang-inspired):
- `Silent` (0) - Only errors
- `Normal` (1) - Errors + warnings (default)
- `Verbose` (2) - + Compilation stages
- `Debug` (3) - + Internal debugging
- `Trace` (4) - + Everything (AST dumps, IR)

**Methods**:
- `error()` - Always shown
- `warn()` - Normal+
- `info()` - Verbose+
- `debug()` - Debug+
- `trace()` - Trace only

---

## Design Patterns

### 1. Visitor Pattern (Modified)

The code generator uses a visitor-like pattern:

```typescript
generateExpression(expr: Expression, params: string[]): string {
  switch (expr.type) {
    case 'number': return this.generateNumber(expr);
    case 'binary': return this.generateBinary(expr, params);
    case 'call': return this.generateCall(expr, params);
    // ... dispatch based on node type
  }
}
```

**Benefit**: Easy to add new expression types without modifying existing code.

### 2. Delegation Pattern

Main generator delegates to specialized generators:

```typescript
if (method === 'map') {
  return this.arrayGen.generateArrayMap(expr, object, params);
}
if (method === 'concat') {
  return this.stringGen.generateStringConcat(expr, object, params);
}
```

**Callback Binding**:
```typescript
this.arrayGen.generateExpression = this.generateExpression.bind(this);
this.stringGen.generateExpression = this.generateExpression.bind(this);
```

**Benefit**: Modularity without tight coupling.

### 3. Singleton Pattern

Logger uses singleton:

```typescript
export const logger = new Logger();
```

**Benefit**: Global access, single configuration point.

### 4. Builder Pattern

LLVM IR is built incrementally:

```typescript
emit(instruction: string) {
  this.output.push(instruction);
}

getOutput(): string[] {
  return this.output;
}
```

### 5. Template Method Pattern

Base generator defines template for all generators:

```typescript
class BaseGenerator {
  protected tempCounter = 0;
  protected labelCounter = 0;

  protected nextTemp(): string {
    return `%${this.tempCounter++}`;
  }

  protected nextLabel(): string {
    return `.L${this.labelCounter++}`;
  }
}
```

**Subclasses** override specific behavior while inheriting shared utilities.

---

## Data Flow

### High-Level Data Flow

```
Source Code (string)
    ↓
Parser.parse()
    ↓
AST (types.ts)
    ↓
SemanticAnalyzer.analyze()
    ↓
Validated AST + Symbol Table
    ↓
TypeChecker (optional)
    ↓
LLVMGenerator.generate()
    ↓
LLVM IR (string)
    ↓
Write to .ll file
    ↓
llc (external tool)
    ↓
Object file (.o)
    ↓
clang/gcc (external tool)
    ↓
Native executable
```

### Internal Generator Data Flow

```
AST Node
    ↓
LLVMGenerator.generateExpression()
    ↓
Type-based dispatch
    ↓
    ├─→ ArrayGenerator (if array operation)
    ├─→ StringGenerator (if string operation)
    ├─→ ClassGenerator (if class/method)
    └─→ Direct generation (if simple operation)
    ↓
LLVM IR instructions (emitted to output buffer)
    ↓
nextTemp() calls generate unique register names
    ↓
Return register name containing result
```

### Variable Tracking

```
Variable Declaration
    ↓
Generate alloca instruction
    ↓
Store register name in variables map
    ↓
Store LLVM type in variableTypes map
    ↓
(For objects/arrays) Store metadata
    ↓
Variable Reference
    ↓
Look up in variables map
    ↓
Generate load instruction
    ↓
Return register containing value
```

---

## Extension Points

### Adding a New Built-in Function

**Example**: Adding `Math.abs()`

1. **Declare external function** (`llvm-generator.ts`):
```typescript
private declareExternalFunctions() {
  this.output.push('declare double @fabs(double)');
}
```

2. **Handle in generateCall** (`llvm-generator.ts`):
```typescript
if (expr.callee.type === 'member_access') {
  if (expr.callee.object.name === 'Math' && expr.callee.property === 'abs') {
    const argReg = this.generateExpression(expr.arguments[0], params);
    const resultReg = this.nextTemp();
    this.emit(`${resultReg} = call double @fabs(double ${argReg})`);
    return resultReg;
  }
}
```

3. **Add test** (`tests/fixtures/arithmetic/math-abs.js`):
```javascript
function test() {
  return Math.abs(-42);
}
process.exit(test());
```

4. **Add test case** (`tests/compiler.test.ts`):
```typescript
{
  name: 'math-abs',
  fixture: 'tests/fixtures/arithmetic/math-abs.js',
  expectedExitCode: 42,
  description: 'Math.abs() should return absolute value'
}
```

### Adding a New AST Node Type

**Example**: Adding a `switch` statement

1. **Define AST node** (`ast/types.ts`):
```typescript
export interface SwitchStatement {
  type: 'switch';
  discriminant: Expression;
  cases: SwitchCase[];
}

export interface SwitchCase {
  test: Expression | null; // null for default
  consequent: Statement[];
}
```

2. **Add to Statement union**:
```typescript
export type Statement =
  | VariableDeclaration
  | AssignmentStatement
  | SwitchStatement  // Add here
  | ...;
```

3. **Parse it** (`parser/parser.ts`):
```typescript
private parseStatement(): Statement {
  if (this.match('switch')) {
    return this.parseSwitchStatement();
  }
  // ...
}

private parseSwitchStatement(): SwitchStatement {
  // Parse logic here
}
```

4. **Generate code** (`codegen/llvm-generator.ts` or new generator):
```typescript
private generateStatement(stmt: Statement, params: string[]): void {
  if (stmt.type === 'switch') {
    this.generateSwitchStatement(stmt, params);
  }
  // ...
}

private generateSwitchStatement(stmt: SwitchStatement, params: string[]): void {
  // Generate LLVM IR for switch
}
```

### Adding a New Data Structure

**Example**: Adding a `Queue` type

1. **Create generator** (`src/codegen/generators/queue-generator.ts`):
```typescript
export class QueueGenerator extends BaseGenerator {
  generateQueuePush(expr: CallNode, object: Expression, params: string[]): string {
    // Implementation
  }

  generateQueuePop(expr: CallNode, object: Expression, params: string[]): string {
    // Implementation
  }
}
```

2. **Integrate in main generator** (`llvm-generator.ts`):
```typescript
private queueGen: QueueGenerator;

constructor(ast: AST, typeChecker: TypeChecker | null) {
  this.queueGen = new QueueGenerator();
  this.queueGen.generateExpression = this.generateExpression.bind(this);
}
```

3. **Handle in generateMethodCall**:
```typescript
if (method === 'push' && this.isQueue(object)) {
  return this.queueGen.generateQueuePush(expr, object, params);
}
```

---

## Architecture Decisions

### Why LLVM?

**Pros**:
- Industry-standard compiler infrastructure
- Excellent optimization passes
- Supports multiple architectures (x86-64, ARM64, etc.)
- Well-documented IR format
- Used by Clang, Rust, Swift, etc.

**Cons**:
- LLVM IR is verbose
- Requires learning LLVM concepts (SSA, phi nodes, etc.)

**Decision**: The benefits outweigh the learning curve. LLVM provides production-quality optimization and cross-platform support.

### Why Hand-Written Parser?

**Alternatives**: Parser generators (ANTLR, PEG.js, etc.)

**Decision**: Hand-written recursive descent parser

**Rationale**:
- Full control over error messages
- Easy to understand and modify
- No external tool dependencies
- Better debugging experience
- Flexible handling of edge cases

**Trade-off**: More code to maintain, but worth it for error message quality.

### Why Specialized Generators?

**Alternative**: Single monolithic generator

**Decision**: Modular generator architecture with delegation

**Rationale**:
- **Maintainability**: Easier to find and modify specific features
- **Testability**: Each generator can be tested independently
- **Scalability**: New features don't bloat the main generator
- **Clarity**: Each generator has a single, well-defined responsibility

**Trade-off**: Slightly more complex plumbing, but significantly better organization.

### Why String-Based LLVM IR Generation?

**Alternative**: Use LLVM C++ API directly

**Decision**: Generate LLVM IR as text strings

**Rationale**:
- **Simplicity**: Text generation is straightforward
- **Portability**: No C++ binding dependencies
- **Debugging**: Easy to inspect generated IR
- **Flexibility**: Easy to template and manipulate

**Trade-off**: No compile-time validation of IR, but caught by llc.

### Why TypeScript for Implementation?

**Decision**: TypeScript (targeting self-hosting later)

**Rationale**:
- **Type safety**: Catches bugs at compile time
- **Developer experience**: Excellent tooling and IDE support
- **Ecosystem**: npm packages for utilities
- **Bootstrapping**: Can eventually compile itself

**Trade-off**: Requires Node.js for development, but final output is native.

---

## Future Improvements

### Architecture Enhancements

1. **IR Optimization Pass**: Add a ChadScript-specific optimization pass before LLVM
2. **Multi-threaded Compilation**: Parallelize file parsing and code generation
3. **Incremental Compilation**: Only recompile changed files
4. **Module System**: Better handling of libraries and dependencies

### Code Quality

1. **Split Large Files**: Break parser.ts and llvm-generator.ts into smaller modules
2. **Unified Symbol Table**: Replace multiple tracking maps with single SymbolTable class
3. **Error Recovery**: Continue parsing after errors to report multiple issues
4. **Formal Interfaces**: Replace callback binding with explicit interfaces

### Testing

1. **Unit Tests**: Add unit tests for individual generators
2. **Integration Tests**: More end-to-end tests for complex scenarios
3. **Performance Benchmarks**: Track compilation speed and binary performance
4. **Fuzzing**: Random input generation to find edge cases

---

## Resources

### Internal Documentation

- `README.md` - User-facing documentation and quick start
- `TYPESCRIPT.md` - TypeScript-specific features
- `AGENTS.md` - Guide for AI agents
- `tests/fixtures/README.md` - Test organization guide

### External Resources

- [LLVM Language Reference](https://llvm.org/docs/LangRef.html) - LLVM IR documentation
- [Clang Internals](https://clang.llvm.org/docs/InternalsManual.html) - Compiler design patterns
- [TypeScript Compiler API](https://github.com/Microsoft/TypeScript/wiki/Using-the-Compiler-API) - For type-checker.ts

---

## Contributing

See `CONTRIBUTING.md` for detailed contribution guidelines, including:
- How to add new features
- Code style and conventions
- Testing requirements
- Pull request process

---

**Last Updated**: Nov 2025
**Version**: 0.1.0
**Maintainer**: ChadScript Team
