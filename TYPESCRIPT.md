# TypeScript in ChadScript

## Overview

ChadScript compiles TypeScript to native machine code via LLVM. TypeScript's type system provides **compile-time struct layouts** - enabling zero-overhead property access on objects passed as function parameters.

Unlike JavaScript, where `function f(obj) { return obj.x; }` has no type information, TypeScript interfaces tell ChadScript exactly how to lay out structs in memory.

## Quick Start

```typescript
interface Point {
  x: number;
  y: number;
}

function distance(p: Point): number {
  return p.x + p.y;  // Type-aware struct access!
}

const point = { x: 3, y: 4 };
distance(point);
```

```bash
npx tsx src/index.ts myfile.ts        # Compiles to ./myfile
./myfile                               # Native binary, no runtime!
```

## Type System

### TypeScript → LLVM Mappings

| TypeScript Type | LLVM Type | Native Size | Notes |
|----------------|-----------|-------------|-------|
| `number` | `double` | 8 bytes | 64-bit floating point |
| `string` | `i8*` | 8 bytes (ptr) | C-style null-terminated string |
| `boolean` | `i32` | 4 bytes | 0 = false, 1 = true |
| `Array<T>` | `%Array*` | 8 bytes (ptr) | Dynamic array struct |
| `Map<K,V>` | `%Map*` | 8 bytes (ptr) | Hash table struct |
| `Set<T>` | `%Set*` | 8 bytes (ptr) | Hash set struct |
| Interface | `{ T1, T2, ... }*` | 8 bytes (ptr) | Packed struct |

**Note:** TypeScript does NOT have i8/i16/i64 types. Use `number` for all integers.

### Interface → Struct Compilation

Interfaces define struct layouts at compile-time:

```typescript
interface User {
  name: string;    // offset 0: i8*
  age: number;     // offset 8: double
  active: boolean; // offset 16: double
}
```

Compiles to LLVM struct:
```llvm
%User = type { i8*, double, double }  ; 24 bytes
```

**Important:** Property order matters! Fields are laid out in declaration order.

## Supported Features

### ✅ Core Language

- **Variables:** `let`, `const` (no `var`)
- **Functions:** Named functions, arrow functions
- **Classes:** Constructors, methods, inheritance (`extends`)
- **Control flow:** `if/else`, `while`, `for`, `break`, `continue`
- **Operators:** `+`, `-`, `*`, `/`, `%`, `&&`, `||`, `!`, `===`, `!==`, `<`, `>`, `<=`, `>=`
- **Ternary:** `condition ? a : b`
- **Template literals:** `` `Hello ${name}` ``

### ✅ Data Structures

- **Arrays:** `[1, 2, 3]`, `.length`, `.push()`, `.find()`, `.filter()`, `.map()`, `.some()`, `.forEach()`
- **Objects:** `{ x: 10, y: 20 }`, property access on locals and literals
- **Maps:** `new Map()`, `.set()`, `.get()`, `.has()`, `.delete()`, `.size`
- **Sets:** `new Set()`, `.add()`, `.has()`, `.delete()`, `.size`
- **Strings:** `.length`, `[i]`, `.substr()`, `.concat()`, `.repeat()`, `.padStart()`, `.split()`
- **Regex:** `/pattern/flags`, `.test()`

### ✅ TypeScript-Specific

- **Interfaces:** Define struct layouts for function parameters
- **Type annotations:** `: number`, `: string`, `: boolean`
- **Class field types:** Type annotations on class fields

```typescript
interface Config {
  port: number;
  host: string;
}

function startServer(config: Config): number {
  console.log(config.host);  // TypeScript enables this!
  return config.port;
}
```

### ✅ Node.js APIs (Built-in)

- **console:** `.log()`, `.error()`
- **process:** `.exit()`, `.argv` (command-line args)
- **fs:** `.readFileSync()`, `.writeFileSync()`, `.unlinkSync()`, `.existsSync()`
- **path:** `.resolve()`, `.dirname()`
- **String():** String constructor

## Known Limitations

### ❌ Cannot Be Implemented

These features require runtime capabilities that don't exist in AOT-compiled native code:

- **`eval()`, `Function()`:** Dynamic code execution
- **`Symbol`:** Runtime symbol registry
- **Reflection:** `typeof`, `instanceof`, `Object.keys()`, `Object.values()`
- **Prototypes:** `.__proto__`, `.prototype`, dynamic property lookup
- **Dynamic properties:** `obj[variable]` where key isn't known at compile-time
- **`delete` operator:** Struct fields are fixed at compile-time
- **Property descriptors:** `Object.defineProperty()`, getters/setters
- **Proxies:** `new Proxy()`
- **WeakMap/WeakSet:** Require garbage collection
- **Async/Await:** No event loop or runtime scheduler
- **Promises:** No microtask queue
- **Generators:** `function*`, `yield`
- **Decorators:** `@decorator`
- **`with` statement:** Dynamic scope
- **`arguments` object:** Use rest parameters instead
- **Spread in objects:** `{ ...obj }` (array spread works)
- **Destructuring:** `const { x, y } = point` (workaround: access properties directly)
- **Optional chaining:** `obj?.prop?.nested` (workaround: explicit null checks)
- **Nullish coalescing:** `??` (workaround: use ternary)

### ⚠️ Current Limitations (May Be Added Later)

- **Union types:** `string | number` - only one type per field
- **Tuple types:** `[string, number]` - use objects or separate variables
- **Generics:** `Array<T>` works, but custom generics don't
- **Enums:** Use regular objects or constants
- **Type aliases:** `type Point = { x: number }` - use interfaces
- **Rest parameters:** `...args` - fixed parameter lists only
- **Default parameters:** `function f(x = 10)` - specify all args
- **Object methods:** `{ add(x) { } }` - use regular functions
- **Computed property names:** `{ [key]: value }`
- **BigInt:** `123n` - use regular numbers instead

### 🔧 Workarounds

#### Destructuring → Direct Access
```typescript
// ❌ Doesn't work
const { x, y } = point;

// ✅ Works
const x = point.x;
const y = point.y;
```

#### Optional Chaining → Null Checks
```typescript
// ❌ Doesn't work
const name = user?.profile?.name;

// ✅ Works
let name = "";
if (user !== null) {
  if (user.profile !== null) {
    name = user.profile.name;
  }
}
```

#### Dynamic Properties → Static Access
```typescript
// ❌ Doesn't work
const field = "name";
const value = obj[field];

// ✅ Works
const value = obj.name;
```

## Best Practices

### 1. Always Use Interfaces for Function Parameters

```typescript
// ✅ Good: TypeScript knows the layout
interface User {
  name: string;
  age: number;
}

function greet(user: User): string {
  return user.name;  // Compiles to efficient struct access
}

// ❌ Bad: No type information
function greet(user) {
  return user.name;  // ERROR: Cannot access property on untyped parameter
}
```

### 2. Keep Interfaces Simple

```typescript
// ✅ Good: Flat struct
interface Config {
  host: string;
  port: number;
  debug: boolean;
}

// ⚠️ Challenging: Nested objects require careful handling
interface Config {
  server: {
    host: string;
    port: number;
  };
}
```

### 3. Use Arrays for Collections

```typescript
// ✅ Good: Arrays are first-class
const users: User[] = [];
users.push(newUser);
const found = users.find(u => u.age > 18);

// ❌ Bad: Dynamic objects don't work
const userMap = {};
userMap[id] = user;  // ERROR: Dynamic property access
```

### 4. Prefer Value Returns Over Mutation

```typescript
// ✅ Good: Return new values
function increment(x: number): number {
  return x + 1;
}

// ⚠️ Works but less idiomatic
function increment(x: number[]): void {
  x[0] = x[0] + 1;  // Mutates array
}
```

## Common Errors

### "Cannot access property on function parameter"

**Cause:** Missing TypeScript type annotation

```typescript
// ❌ Error
function process(data) {
  return data.value;
}

// ✅ Fix: Add interface
interface Data {
  value: number;
}

function process(data: Data): number {
  return data.value;
}
```

### "Unexpected token"

**Cause:** Using unsupported syntax (destructuring, optional chaining, etc.)

```typescript
// ❌ Error
const { x, y } = point;

// ✅ Fix: Direct access
const x = point.x;
const y = point.y;
```

### "Unknown variable"

**Cause:** Variable used before declaration, or wrong scope

```typescript
// ❌ Error
console.log(x);
const x = 10;

// ✅ Fix: Declare first
const x = 10;
console.log(x);
```

## Performance Tips

### Memory Layout

Structs are packed in memory. Smaller types first reduces padding:

```typescript
// ⚠️ Suboptimal: 32 bytes (poor packing)
interface BadLayout {
  flag: boolean;    // 8 bytes (double)
  name: string;     // 8 bytes (i8*)
  count: number;    // 8 bytes (double)
}

// ✅ Better: 24 bytes (pointers first, numbers together)
interface GoodLayout {
  name: string;     // 8 bytes (i8*)
  count: number;    // 8 bytes (double)
  flag: boolean;    // 8 bytes (double)
}
```

### Avoid Allocations in Loops

```typescript
// ⚠️ Slower: Allocates on every iteration
for (let i = 0; i < 1000; i = i + 1) {
  const temp = { x: i, y: i };
  process(temp);
}

// ✅ Faster: Reuse allocation
const temp = { x: 0, y: 0 };
for (let i = 0; i < 1000; i = i + 1) {
  temp.x = i;
  temp.y = i;
  process(temp);
}
```

## Examples

See `tests/fixtures/` for 70+ working examples:
- `typescript-struct.ts` - Interface with struct access
- `typescript-interface.ts` - Complex interface usage
- `array-*.js` - Array operations
- `class-*.js` - Class examples
- `object-*.js` - Object literal usage
- `string-*.js` - String manipulation

## FAQ

**Q: Why does my .ts file fail to compile?**
A: If you see "Unexpected token", you're using unsupported syntax like destructuring or optional chaining. ChadScript uses TypeScript types to generate efficient native code, but doesn't support all TypeScript syntax.

**Q: Can I use existing TypeScript libraries?**
A: No. ChadScript compiles to native code without a JavaScript runtime. Only built-in functions (console, fs, etc.) are supported.

**Q: Does ChadScript support floating point?**
A: Yes. The `number` type maps to `double` (64-bit float) in LLVM, supporting decimal values like `3.14`. All numeric operations use floating point arithmetic.

**Q: How do I debug?**
A: Use `console.log()` statements. The compiler generates LLVM IR (`.ll` files) you can inspect.

**Q: Is this production-ready?**
A: No. ChadScript is experimental. Use for learning, prototyping, or fun projects.

**Q: Can I call C libraries?**
A: Not yet, but LLVM IR supports FFI. This could be added by declaring external functions.

## Troubleshooting

### Compilation fails with "llc: command not found"

Install LLVM:
```bash
# Ubuntu/Debian
sudo apt-get install llvm

# macOS
brew install llvm

# Fedora
sudo dnf install llvm
```

### Compilation succeeds but executable doesn't run

Check that you have `clang` or `gcc` installed for linking:
```bash
which clang || which gcc
```

### Type information not being used

Make sure:
1. File has `.ts` extension (not `.js`)
2. Interface is defined before the function
3. Function parameter has type annotation: `param: InterfaceName`

## Contributing

ChadScript is experimental! If you find bugs or want to add features, contributions welcome.

See `CLAUDE.md` for architecture notes and development guidelines.
