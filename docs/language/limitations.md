# Language Support

ChadScript supports a practical subset of TypeScript. All types must be known at compile time — there's no runtime type system, no interpreter, and no VM. This page covers what works, what doesn't, and what works with caveats.

## What Works

### Core Language

- `let`, `const`, `var` declarations
- Functions (named, arrow, async, with default parameters and rest parameters)
- `if`/`else if`/`else`, `for`, `for...of`, `while`, `switch`
- `break`, `continue`, `return`
- `try`/`catch`/`finally`, `throw`
- Template literals (`` `hello ${name}` ``)
- Destructuring (arrays and objects)
- Spread operator (`...`)
- Ternary operator (`? :`)
- Nullish coalescing (`??`)
- Type assertions (`as Type`)
- `typeof` (resolved at compile time)
- All arithmetic, comparison, logical, and bitwise operators
- Pre/post increment/decrement (`++`, `--`)
- Compound assignment (`+=`, `-=`, `*=`, `/=`, `|=`, `&=`)
- Regular expressions (`/pattern/flags`, `.test()`, `.exec()`, `.match()`)

### Types and Data Structures

- `number` (64-bit float), `string`, `boolean`, `null`, `undefined`
- `number[]`, `string[]` (typed arrays)
- `Uint8Array`
- Object literals and interfaces (compiled to fixed-layout structs)
- `Map<K, V>`, `Set<T>`
- Enums (numeric)
- Type aliases
- Union types (when all members share the same memory layout — see caveats below)

### Classes

- Constructors, methods, fields, `this`
- Single inheritance (`extends`)
- `implements` (interfaces)
- Parameter properties (`constructor(private name: string)`)
- Getters and setters

### Async

- `async`/`await`
- `Promise.all`, `Promise.race`, `Promise.allSettled`, `Promise.any`
- `Promise.resolve`, `Promise.reject`, `.then()`, `.catch()`, `.finally()`
- `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`

### Modules

- `import { foo } from './bar'`
- `import * as bar from './bar'`
- `import { foo as baz } from './bar'`
- Default imports
- Named exports

### Built-In Standard Library

Everything is built in — no `npm install` needed. See the [Standard Library](/stdlib/) docs for full API details.

`console` · `process` · `fs` · `path` · `child_process` · `os` · `Math` · `JSON` · `Date` · `crypto` · `sqlite` · `fetch` · `httpServe` · `RegExp` · `Map` · `Set` · `ChadScript.embed`

## What Doesn't Work

These features are not supported and will either fail at compile time or are simply not available.

### Dynamic Features

ChadScript compiles to native machine code. Anything that requires evaluating code at runtime is not possible.

- **`eval()`** — no runtime code evaluation
- **`Function()` constructor** — same reason
- **Dynamic `import()`** — only static imports
- **`Proxy` / `Reflect`** — require runtime interception
- **`Symbol`** — not supported
- **Computed property access on objects** (`obj[someVar]`) — object fields are fixed at compile time. Array index access (`arr[i]`) works fine.
- **`globalThis`** — not available

### Type System Restrictions

Every variable must have a concrete type known at compile time.

- **`any`** — rejected at compile time
- **`unknown`** — rejected at compile time
- **`never`** — not handled
- **User-defined generics** — you cannot write `function foo<T>(x: T): T`. Built-in generics (`Map<K,V>`, `Set<T>`, `JSON.parse<T>()`) work.
- **Intersection types** (`A & B`) — not supported
- **Mapped types**, **conditional types**, **template literal types** — not supported
- **`satisfies`** — not supported
- **`instanceof`** — no runtime type tags exist

### Unsupported Syntax

- **Generator functions** (`function*`, `yield`)
- **Async generators** / **`for await...of`**
- **Decorators**
- **`do...while`** loops
- **Tagged template literals**
- **Private class fields** (`#field`)
- **Static class methods and fields**
- **Abstract classes**
- **Labeled statements**
- **`with` statement**
- **`void` operator** (as an expression)
- **`delete` operator** (on object properties — `Map.delete()` and `Set.delete()` work)
- **`in` operator** (for property checks)
- **Comma operator**
- **Re-exports** (`export { foo } from './bar'`)
- **`export default`**

### Missing Built-Ins

- **`WeakMap`**, **`WeakSet`**, **`WeakRef`**
- **`SharedArrayBuffer`**, **`Atomics`**
- **`FinalizationRegistry`**
- **`Intl`** (internationalization)
- **`globalThis`**

### No npm Compatibility

ChadScript is not a drop-in Node.js replacement. npm packages assume V8 runtime semantics, a garbage collector model, dynamic types, and Node APIs that don't exist here. Some pure-TypeScript packages that use only supported features might work in theory, but in practice most won't.

### No REPL

There's no interpreter mode. Everything goes through the full compile pipeline.

## What Works With Caveats

### Union Types

`string | null` works because both are pointers (`i8*`) under the hood. But `string | number` is rejected at compile time because they have different memory representations (`i8*` vs `double`). As a rule: unions work when all members map to the same LLVM type.

### Closures

Arrow functions and nested functions can capture outer variables, but **captures are by value, not by reference**. If you mutate a variable after a closure captures it, the closure won't see the change.

```typescript
let x = 1;
const f = () => console.log(x);
x = 2;
f(); // prints 1, not 2
```

### `for...in`

Supported, but desugared to `for...of Object.keys(obj)`. It iterates own property names only — no prototype chain walking.

### `switch` Statements

Supported, but desugared to if-else chains. Fall-through behavior is stripped — each case is independent.

### `typeof`

Returns the expected strings (`"number"`, `"string"`, `"boolean"`, `"function"`, `"undefined"`, `"object"`), but the result is determined at compile time based on the declared type.

### Numbers

All numbers are `number` (no separate integer type in the type system), but the compiler automatically uses native 64-bit integers for values initialized as integer literals. Integer arithmetic (`+`, `-`, `*`, `%`) between integer values stays in integer registers for better performance. Division always returns a float. The conversion between integer and float representations is automatic — you don't need to think about it.

### Strings

Strings are null-terminated C strings (`i8*`), not JavaScript's UTF-16 strings. They work fine for ASCII and UTF-8 text, but cannot contain embedded null bytes.

### Access Modifiers

`private`, `public`, `protected`, and `readonly` are parsed but **not enforced** — all fields are accessible regardless of modifier.

### Method Dispatch

Method calls on classes are resolved at compile time (static dispatch). There are no vtables and no polymorphic dispatch. The compiler resolves methods based on the declared type, not the actual runtime type.
