# Code Generation Architecture

This directory contains the LLVM IR code generation system for ChadScript. The architecture uses a main orchestrator (`LLVMGenerator`) with specialized sub-generators for different language features.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     LLVMGenerator                            │
│                  (Main Orchestrator)                         │
│  - Coordinates all code generation                          │
│  - Manages top-level structures (imports, functions)        │
│  - Delegates to specialized generators                      │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ ArrayGenerator│  │StringGenerator│  │ ClassGenerator│
│  (48KB)       │  │  (42KB)       │  │  (17KB)       │
│               │  │               │  │               │
│ • push()      │  │ • concat()    │  │ • constructor │
│ • pop()       │  │ • substr()    │  │ • methods     │
│ • find()      │  │ • repeat()    │  │ • inheritance │
│ • filter()    │  │ • padStart()  │  │ • this/super  │
│ • forEach()   │  │ • trim()      │  │               │
│ • map()       │  │ • indexOf()   │  │               │
└───────────────┘  └───────────────┘  └───────────────┘

┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│  MapGenerator │  │  SetGenerator │  │ObjectGenerator│
│  (12KB)       │  │  (9KB)        │  │  (3KB)        │
│               │  │               │  │               │
│ • set()       │  │ • add()       │  │ • literals    │
│ • get()       │  │ • has()       │  │ • property    │
│ • has()       │  │ • delete()    │  │   access      │
└───────────────┘  └───────────────┘  └───────────────┘

┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ControlFlowGen │  │ RegexGenerator│  │SymbolTable    │
│  (13KB)       │  │  (3KB)        │  │  (NEW)        │
│               │  │               │  │               │
│ • if/else     │  │ • test()      │  │ • Unified var │
│ • while       │  │ • match()     │  │   tracking    │
│ • for         │  │ • exec()      │  │ • Type-safe   │
│ • break       │  │               │  │   lookups     │
│ • continue    │  │               │  │               │
└───────────────┘  └───────────────┘  └───────────────┘

                ┌─────────────────────┐
                │   BaseGenerator     │
                │  (Shared State)     │
                │                     │
                │ • tempCounter       │
                │ • labelCounter      │
                │ • output buffer     │
                │ • symbolTable       │
                │ • emit()            │
                │ • nextTemp()        │
                │ • defineVariable()  │
                └─────────────────────┘
```

## File Structure

### Core Files

#### `llvm-generator.ts` (4,073 lines)
Main orchestrator that coordinates code generation.

**Responsibilities:**
- Top-level AST traversal
- Function generation (`generateFunction`)
- Expression generation (`generateExpression`) - dispatches to sub-generators
- Method call routing (`generateMethodCall`) - huge switch statement
- Type checking predicates (`isArrayExpression`, `isStringExpression`, etc.)
- Runtime generation (`generateFetchRuntime`, `generateJSONRuntime`, etc.)
- Main function generation (`generateMain`)

**Key Methods:**
- `generate()`: Entry point, generates complete LLVM IR module
- `generateFunction()`: Converts function AST to LLVM IR
- `generateBlock()`: Converts block statement to LLVM IR
- `generateExpression()`: Routes expression to appropriate generator
- `generateMethodCall()`: Huge method handling all built-in methods

#### `generators/base-generator.ts` (7KB)
Shared state and utilities inherited by all generators.

**Provides:**
- `symbolTable`: Unified variable tracking (NEW)
- `tempCounter`, `labelCounter`: Register/label allocation
- `output`: Instruction buffer
- `globalStrings`: String constant pool
- `emit()`: Add instruction to output
- `nextTemp()`: Allocate new temporary register
- `nextLabel()`: Allocate new label
- `defineVariable()`: Add variable to symbol table (NEW)

**Legacy State (for backward compatibility):**
- `variables`, `variableTypes`: Old variable tracking
- `stringVariables`, `arrayVariables`: Deprecated - use symbolTable
- Other specialized maps

### Specialized Generators

#### `generators/array-generator.ts` (48KB)
Handles all array operations and methods.

**Methods:**
- `generateArrayLiteral()`: Create array from elements
- `generateArrayPush()`: Append element
- `generateArrayPop()`: Remove last element
- `generateArrayFind()`: Find first matching element
- `generateArrayFilter()`: Filter elements by predicate
- `generateArrayForEach()`: Iterate over elements
- `generateArrayMap()`: Transform each element
- `generateArraySome()`: Check if any element matches
- `generateArrayIndexOf()`: Find element index
- `generateArrayIncludes()`: Check if element exists

#### `generators/string-generator.ts` (42KB)
Handles all string operations and methods.

**Methods:**
- `generateStringConcat()`: Concatenate strings
- `generateStringSubstr()`: Extract substring
- `generateStringRepeat()`: Repeat string N times
- `generateStringPadStart()`: Pad string to length
- `generateStringTrim()`: Remove whitespace
- `generateStringIndexOf()`: Find substring index
- `generateStringSplit()`: Split string into array
- `generateStringCharAt()`: Get character at index
- `generateStringToUpperCase()`: Convert to uppercase
- `generateStringToLowerCase()`: Convert to lowercase

#### `generators/class-generator.ts` (17KB)
Handles classes, inheritance, and OOP features.

**Methods:**
- `generateClass()`: Define class struct type
- `generateConstructor()`: Generate constructor function
- `generateMethod()`: Generate instance method
- `generateFieldAccess()`: Access instance field
- `generateThisAccess()`: Handle `this` keyword
- `generateSuperCall()`: Handle `super` calls
- `getClassFields()`: Get field layout for class

#### `generators/map-generator.ts` (12KB)
Handles Map data structure operations.

**Methods:**
- `generateMapNew()`: Create new Map
- `generateMapSet()`: Set key-value pair
- `generateMapGet()`: Get value by key
- `generateMapHas()`: Check if key exists
- `generateMapDelete()`: Remove key-value pair

#### `generators/set-generator.ts` (9KB)
Handles Set data structure operations.

**Methods:**
- `generateSetNew()`: Create new Set
- `generateSetAdd()`: Add element
- `generateSetHas()`: Check if element exists
- `generateSetDelete()`: Remove element

#### `generators/control-flow-generator.ts` (13KB)
Handles control flow statements.

**Methods:**
- `generateIfStatement()`: If/else conditionals
- `generateWhileStatement()`: While loops
- `generateForStatement()`: For loops (including for...of)
- `generateBreak()`: Break from loop
- `generateContinue()`: Continue to next iteration
- `generateTernary()`: Ternary operator (? :)

#### `generators/object-generator.ts` (3KB)
Handles object literals and property access.

**Methods:**
- `generateObjectLiteral()`: Create object from properties
- `generatePropertyAccess()`: Access object property
- `generatePropertyAssignment()`: Assign to object property

#### `generators/regex-generator.ts` (3KB)
Handles regular expression operations.

**Methods:**
- `generateRegexTest()`: Test if string matches pattern
- `generateRegexMatch()`: Find matches in string
- `generateRegexExec()`: Execute regex and get results

#### `symbol-table.ts` (421 lines - NEW!)
Unified variable tracking system.

**Classes:**
- `SymbolTable`: Single source of truth for all variables
- `Symbol`: Entry with name, kind, type, alloca, metadata
- `SymbolKind`: Enum for Number, String, Array, Object, etc.

**Methods:**
- `define()`: Add new symbol with metadata
- `lookup()`: Find symbol by name
- `getType()`, `getAlloca()`: Get symbol properties
- `isString()`, `isArray()`, etc.: Type-safe predicates
- `clear()`: Reset for new scope

**Benefits:**
- Replaces 12 separate tracking maps
- Type-safe symbol kinds
- Rich metadata (object keys, class info, etc.)
- Scope tracking (local vs global)

## Code Generation Flow

### 1. Entry Point
```typescript
const generator = new LLVMGenerator(ast, typeChecker);
const llvmIR = generator.generate();
```

### 2. Top-Level Structure Generation
```typescript
generate() {
  // 1. Generate struct type definitions
  this.generateStructTypes();

  // 2. Generate string constants
  this.globalStrings.forEach(...);

  // 3. Generate extern declarations
  this.generateExternDeclarations();

  // 4. Generate functions
  this.ast.functions.forEach(func => {
    ir += this.generateFunction(func);
  });

  // 5. Generate main()
  ir += this.generateMain();

  return ir;
}
```

### 3. Function Generation
```typescript
generateFunction(func) {
  this.reset(); // Clear state for new function

  // Generate function signature
  ir = `define ${returnType} @${func.name}(${params}) {\n`;
  ir += `entry:\n`;

  // Allocate parameters
  for (const param of func.params) {
    this.emit(`${allocaReg} = alloca ${type}`);
    this.emit(`store ${type} %arg${i}, ${type}* ${allocaReg}`);
    this.defineVariable(param, allocaReg, type, kind); // NEW!
  }

  // Generate body
  this.generateBlock(func.body, func.params);

  ir += this.output.join('\n');
  ir += `}\n`;
  return ir;
}
```

### 4. Expression Generation (Delegation Pattern)
```typescript
generateExpression(expr, params) {
  switch (expr.type) {
    case 'string':
      return this.stringGen.generateString(expr);
    case 'array':
      return this.arrayGen.generateArrayLiteral(expr, params);
    case 'method_call':
      return this.generateMethodCall(expr, params);
    case 'binary':
      return this.generateBinaryOp(expr, params);
    // ... 30+ expression types
  }
}
```

### 5. Method Call Routing
```typescript
generateMethodCall(expr, params) {
  const method = expr.method;

  if (method === 'push') {
    return this.arrayGen.generateArrayPush(expr, params);
  } else if (method === 'concat') {
    return this.stringGen.generateStringConcat(expr, params);
  } else if (method === 'test') {
    return this.regexGen.generateRegexTest(expr, params);
  }
  // ... 100+ methods
}
```

## Design Patterns

### 1. Delegation Pattern
Main generator delegates to specialized sub-generators:
```typescript
// In LLVMGenerator constructor:
this.arrayGen = new ArrayGenerator();
this.arrayGen.generateExpression = this.generateExpression.bind(this);
```

**Benefits:**
- Separation of concerns
- Each generator focuses on one feature
- Easier to test and maintain

**Drawbacks:**
- Callback binding required
- Circular dependencies through bindings
- Hard to track control flow

### 2. Template Method Pattern
Sub-generators inherit from BaseGenerator:
```typescript
export class ArrayGenerator extends BaseGenerator {
  generateArrayPush(expr, params) {
    const temp = this.nextTemp(); // From BaseGenerator
    this.emit(`${temp} = ...`);  // From BaseGenerator
    return temp;
  }
}
```

### 3. Builder Pattern
LLVM IR built incrementally with emit():
```typescript
this.emit(`${temp} = alloca double`);
this.emit(`store double ${value}, double* ${temp}`);
```

### 4. Symbol Table Pattern (NEW!)
Unified variable tracking:
```typescript
// Old way (12 maps):
this.variables.set(name, alloca);
this.variableTypes.set(name, type);
this.stringVariables.set(name, alloca);

// New way (1 table):
this.defineVariable(name, alloca, type, SymbolKind.String);
```

## Type System

### LLVM Types Used
- `double`: All numeric values (float, int, boolean)
- `i32`: Integer operations, array indices, bool conditions
- `i64`: Array lengths, string lengths, memory sizes
- `i8*`: Strings, pointers, opaque data
- `%Array*`: Number arrays
- `%StringArray*`: String arrays
- `%Map*`: Map data structure
- `%Set*`: Set data structure
- `%ClassName_struct*`: Class instances

### Type Conversions
Critical conversions for correctness:
- `fptosi double to i32`: Convert float to int (array indexing)
- `sitofp i32 to double`: Convert int to float (arithmetic)
- `fptosi double to i64`: Convert float to i64 (bitwise ops)

## Common Patterns

### Allocating a Variable
```typescript
const allocaReg = this.nextTemp();
this.emit(`${allocaReg} = alloca double`);
this.emit(`store double ${value}, double* ${allocaReg}`);
this.defineVariable(name, allocaReg, 'double', SymbolKind.Number);
```

### Loading a Variable
```typescript
const allocaReg = this.symbolTable.getAlloca(name);
const loadReg = this.nextTemp();
this.emit(`${loadReg} = load double, double* ${allocaReg}`);
return loadReg;
```

### Calling a Function
```typescript
const resultReg = this.nextTemp();
this.emit(`${resultReg} = call double @functionName(double ${arg1}, double ${arg2})`);
return resultReg;
```

### Generating a String Constant
```typescript
const strName = this.nextString(); // @.str.0
const strValue = '"hello\\00"';
this.globalStrings.push(
  `${strName} = private unnamed_addr constant [6 x i8] c${strValue}`
);
```

### Creating a Label
```typescript
const label = this.nextLabel('if_then'); // if_then0
this.emit(`br label %${label}`);
this.emit(`${label}:`);
```

## Testing

Each generator has corresponding test fixtures:
- `tests/fixtures/arrays/`: Array method tests
- `tests/fixtures/strings/`: String method tests
- `tests/fixtures/classes/`: Class and OOP tests
- `tests/fixtures/data-structures/`: Map/Set tests
- `tests/fixtures/control-flow/`: If/while/for tests

Run specific test category:
```bash
npm test -- --test-name-pattern="Array"
npm test -- --test-name-pattern="String"
npm test -- --test-name-pattern="Class"
```

## Adding New Features

### 1. Adding a New Built-in Method

Example: Adding `String.prototype.replaceAll()`

**Step 1: Add to StringGenerator**
```typescript
// In src/codegen/generators/string-generator.ts
generateStringReplaceAll(expr: MethodCallNode, params: string[]): string {
  const object = expr.object;
  const searchArg = expr.args[0];
  const replaceArg = expr.args[1];

  // Generate LLVM IR for replaceAll...
  const result = this.nextTemp();
  this.emit(`${result} = call i8* @string_replace_all(...)`);
  return result;
}
```

**Step 2: Route in LLVMGenerator**
```typescript
// In src/codegen/llvm-generator.ts, generateMethodCall()
if (method === 'replaceAll') {
  return this.stringGen.generateStringReplaceAll(expr, params);
}
```

**Step 3: Add Extern Declaration**
```typescript
// In generateExternDeclarations()
'declare i8* @string_replace_all(i8*, i8*, i8*)'
```

**Step 4: Add Test**
```typescript
// tests/fixtures/strings/string-replaceall.js
function test() {
  const str = "hello world";
  const result = str.replaceAll("l", "L");
  return result.length;
}
process.exit(test());
```

### 2. Adding a New Data Type

Example: Adding `BigInt` support

**Step 1: Update SymbolTable**
```typescript
// In src/codegen/symbol-table.ts
export enum SymbolKind {
  // ...
  BigInt = 'bigint'
}
```

**Step 2: Create Generator**
```typescript
// Create src/codegen/generators/bigint-generator.ts
export class BigIntGenerator extends BaseGenerator {
  generateBigIntAdd(left, right) {
    // Generate LLVM IR for BigInt addition
  }
}
```

**Step 3: Wire in LLVMGenerator**
```typescript
// In constructor:
this.bigintGen = new BigIntGenerator();
this.bigintGen.generateExpression = this.generateExpression.bind(this);

// In generateExpression():
if (expr.type === 'bigint') {
  return this.bigintGen.generateBigInt(expr);
}
```

## Future Improvements

### Short Term
1. ✅ Unified SymbolTable (DONE)
2. ✅ CompilerError system (DONE)
3. Migrate all variable definitions to use `defineVariable()`
4. Remove deprecated variable tracking maps
5. Add JSDoc to remaining large methods

### Medium Term
1. Extract runtime generation to `runtime-generator.ts`
2. Extract type predicates to `type-predicates.ts`
3. Replace callback binding with explicit interfaces
4. Add error recovery to parser

### Long Term
1. Performance benchmarks
2. Optimization passes
3. Debug info generation
4. Source maps
5. Better error messages with suggestions

## Performance Considerations

### Memory
- Each generator maintains its own output buffer
- Symbol table uses Map for O(1) lookups
- Global strings deduplicated
- Temporary registers reused within functions

### Compilation Speed
- Single-pass compilation (no multiple phases)
- Lazy evaluation where possible
- Direct LLVM IR generation (no intermediate representation)

## Debugging

### Inspecting Generated IR
```bash
# Compile and keep .ll file
npx tsx src/index.ts input.js

# View LLVM IR
cat input.ll

# Validate IR
llvm-as input.ll -o /dev/null
```

### Symbol Table Dump
```typescript
// In your code:
console.error(this.symbolTable.dump());
```

### Output Buffer Inspection
```typescript
// After generation:
console.error(this.output.join('\n'));
```

## Contributing

When adding new features:
1. Add tests first in `tests/fixtures/`
2. Implement in appropriate generator
3. Wire up in `llvm-generator.ts`
4. Update this README
5. Run full test suite: `npm test`
6. Commit with all tests passing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for detailed guidelines.
