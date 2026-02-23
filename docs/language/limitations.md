# Language Support

ChadScript supports a practical subset of TypeScript. All types must be known at compile time — there's no runtime type system, no interpreter, and no VM.

## Core Language

| Feature | Status |
|---------|--------|
| `let`, `const`, `var` | Supported |
| `if`/`else if`/`else`, `for`, `for...of`, `while`, `do...while`, `switch` | Supported |
| `break`, `continue`, `return` | Supported |
| `try`/`catch`/`finally`, `throw` | Supported |
| Template literals (`` `hello ${name}` ``) | Supported |
| Destructuring (arrays and objects) | Supported |
| Spread operator (`...`) | Supported |
| Ternary (`? :`), nullish coalescing (`??`) | Supported |
| Type assertions (`as Type`) | Supported |
| `typeof` | Supported (resolved at compile time) |
| All arithmetic, comparison, logical, bitwise operators | Supported |
| Pre/post increment/decrement (`++`, `--`) | Supported |
| Compound assignment (`+=`, `-=`, `*=`, `/=`, `\|=`, `&=`) | Supported |
| Regular expressions (`/pattern/flags`) | Supported |
| `for...in` | Supported (desugared to `for...of Object.keys()`) |
| Generator functions (`function*`, `yield`) | Not supported |
| Decorators | Not supported |
| Tagged template literals | Not supported |
| Labeled statements | Not supported |
| `with` statement | Not supported |
| Comma operator | Not supported |

## Functions

| Feature | Status |
|---------|--------|
| Named functions | Supported |
| Arrow functions | Supported |
| `async`/`await` | Supported |
| Default parameters | Supported |
| Rest parameters (`...args`) | Supported |
| Closures | Supported (capture by value, not by reference) |
| Async generators / `for await...of` | Not supported |

## Types and Data Structures

| Feature | Status |
|---------|--------|
| `number`, `string`, `boolean`, `null`, `undefined` | Supported |
| `number[]`, `string[]` (typed arrays) | Supported |
| `Uint8Array` | Supported |
| Object literals / interfaces (fixed-layout structs) | Supported |
| `Map<K, V>`, `Set<T>` | Supported |
| Enums (numeric) | Supported |
| Type aliases | Supported |
| Union types (`string \| null`) | Supported (when members share the same memory layout) |
| `any`, `unknown`, `never` | Not supported |
| User-defined generics (`<T>`) | Not supported (built-in generics like `Map<K,V>` work) |
| Intersection types (`A & B`) | Not supported |
| Mapped / conditional / template literal types | Not supported |
| `satisfies` | Not supported |
| `instanceof` | Not supported (no runtime type tags) |
| `Symbol` | Not supported |
| `WeakMap`, `WeakSet`, `WeakRef` | Not supported |
| `SharedArrayBuffer`, `Atomics` | Not supported |
| `FinalizationRegistry` | Not supported |
| `Intl` | Not supported |

## Classes & Interfaces

| Feature | Status |
|---------|--------|
| Properties (typed fields) | Supported |
| Constructors | Supported |
| Parameter properties (`constructor(private name: string)`) | Supported |
| Instance methods | Supported |
| Getters / setters | Supported |
| `extends` (single inheritance) | Supported |
| `implements` | Supported |
| Interface inheritance (`extends`) | Supported |
| Static methods and fields | Supported |
| Abstract classes | Not yet supported |
| Private class fields (`#field`) | Not supported |
| Decorators | Not supported |

**Notes:**
- **Static dispatch** — method calls are resolved at compile time based on the declared type, not the runtime type
- **Interfaces are data-only** — interfaces define fields, not methods. To attach methods to a type, use a class
- **Access modifiers** — `private`/`protected`/`readonly` are parsed but not enforced at runtime. Run `chad init` for editor-level type checking
- **Interface field ordering** — object literals are automatically reordered to match the interface's declared field order

## Modules

| Feature | Status |
|---------|--------|
| `import { foo } from './bar'` | Supported |
| `import * as bar from './bar'` | Supported |
| `import { foo as baz } from './bar'` | Supported |
| Default imports | Supported |
| Named exports | Supported |
| Dynamic `import()` | Not supported |
| Re-exports (`export { foo } from './bar'`) | Supported |
| `export default` | Supported |

## Async

| Feature | Status |
|---------|--------|
| `async`/`await` | Supported |
| `Promise.all`, `Promise.race`, `Promise.allSettled`, `Promise.any` | Supported |
| `Promise.resolve`, `Promise.reject` | Supported |
| `.then()`, `.catch()`, `.finally()` | Supported |
| `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval` | Supported |

## Dynamic Features

These require runtime code evaluation and are not possible in a native compiler:

| Feature | Why |
|---------|-----|
| `eval()` | No runtime code evaluation |
| `Function()` constructor | No runtime code evaluation |
| `Proxy` / `Reflect` | Require runtime interception |
| Computed property access (`obj[someVar]`) | Object fields are fixed at compile time (array index access works) |
| `globalThis` | Not available |

## Numbers

All numbers are `number` (no separate integer type), but the compiler automatically uses native 64-bit integers for values initialized as integer literals. Integer arithmetic (`+`, `-`, `*`, `%`) between integer values stays in integer registers for better performance. Division always returns a float. The conversion is automatic.

## Strings

Strings are null-terminated C strings, not JavaScript's UTF-16 strings. They work fine for ASCII and UTF-8 text but cannot contain embedded null bytes.

## Closures

Arrow functions and nested functions can capture outer variables, but captures are **by value, not by reference**. If you mutate a variable after a closure captures it, the closure won't see the change:

```typescript
let x = 1;
const f = () => console.log(x);
x = 2;
f(); // prints 1, not 2
```

## npm Compatibility

npm packages work as long as they only use supported TypeScript features.

## Standard Library

Everything is built in — no `npm install` needed:

`ChadScript.embed` · `child_process` · `console` · `crypto` · `Date` · `fetch` · `fs` · `httpServe` · `JSON` · `Map` · `Math` · `os` · `path` · `process` · `RegExp` · `Set` · `sqlite`
