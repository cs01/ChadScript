# Language

ChadScript is a statically-typed subset of TypeScript. You can write standard TypeScript constructs — variables, functions, classes, interfaces, async/await, modules — as long as all types can be resolved at compile time.

What this means in practice:
- No `any`, `unknown`, or mixed union types like `string | number`
- No runtime type inspection (`instanceof`, runtime `typeof`)
- No dynamic code execution (`eval`, dynamic `import()`)
- Closures capture by value — mutating a variable after capturing it is a compile error

The [Standard Library](/stdlib/) covers common needs — HTTP, SQLite, fetch, crypto, JSON, filesystem — without external packages.

The tables below describe the full feature set and support status.

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
| Computed property access (`obj[key]`) | Supported (read and write, for objects with known fields) |
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
| Closures | Supported (capture by value; post-capture mutation is a compile error) |
| `declare function` (FFI) | Supported (see [FFI](/language/ffi)) |
| Async generators / `for await...of` | Not supported |

## Types and Data Structures

| Feature | Status |
|---------|--------|
| `number`, `string`, `boolean`, `null`, `undefined` | Supported |
| `number[]`, `string[]` (typed arrays) | Supported |
| `Uint8Array` | Supported |
| Object literals / interfaces (fixed-layout structs) | Supported |
| `Map<K, V>`, `Set<T>` | Supported |
| Enums (numeric and string) | Supported |
| Type aliases | Supported |
| Union types (`string \| null`) | Supported (nullable unions only) |
| `any`, `unknown`, `never` | Not supported |
| User-defined generics (`<T>`) | Not supported |
| Intersection types (`A & B`) | Not supported |
| Mapped / conditional / template literal types | Not supported |
| `satisfies`, `instanceof`, `Symbol` | Not supported |
| `WeakMap`, `WeakSet`, `WeakRef` | Not supported |
| `SharedArrayBuffer`, `Atomics` | Not supported |
| `FinalizationRegistry`, `Intl` | Not supported |

## Classes & Interfaces

Classes and interfaces work like standard TypeScript with a few differences.

**Key differences from TypeScript:**

- **No `instanceof`** — there are no runtime type tags
- **Static dispatch** — method calls are resolved at compile time, not dynamically
- **Interfaces are data-only** — interfaces define fields, not methods. To attach methods to a type, use a class.
- **Access modifiers not enforced at runtime** — `private`/`protected` are parsed but all fields are accessible in the compiled output. Run `chad init` to get TypeScript type-checking in your editor, which will flag access violations before you compile.

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

**Interface field ordering** — object literals are automatically reordered to match the interface's declared field order. You can write fields in any order:

```typescript
interface Person {
  name: string;
  age: number;
  city: string;
}

const p: Person = { age: 30, city: "NYC", name: "Alice" }; // works fine
```

## Modules

| Feature | Status |
|---------|--------|
| `import { foo } from './bar'` | Supported |
| `import * as bar from './bar'` | Supported |
| `import { foo as baz } from './bar'` | Supported |
| Default imports | Supported |
| Named exports | Supported |
| Re-exports (`export { foo } from './bar'`) | Supported |
| `export default` | Supported |
| Dynamic `import()` | Not supported |

## Async

| Feature | Status |
|---------|--------|
| `async`/`await` | Supported |
| `Promise.all`, `Promise.race`, `Promise.allSettled`, `Promise.any` | Supported |
| `Promise.resolve`, `Promise.reject` | Supported |
| `.then()`, `.catch()`, `.finally()` | Supported |
| `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval` | Supported |

## JSX

| Feature | Status |
|---------|--------|
| JSX elements (`<Tag prop={v} />`) | Supported (desugared to `createElement()` calls) |
| Fragments (`<>...</>`) | Supported |
| Expression attributes (`prop={expr}`) | Supported |
| String attributes (`prop="text"`) | Supported |
| Self-closing elements (`<Tag />`) | Supported |
| Nested elements | Supported |

JSX is desugared at parse time into `createElement(tag, props, children)` calls. You provide the `createElement` function — ChadScript doesn't ship a framework. Files must use `.tsx` extension.

## Dynamic Features

These require runtime code evaluation and are not possible in a native compiler:

| Feature | Status |
|---------|--------|
| `eval()` | Not supported |
| `Function()` constructor | Not supported |
| `Proxy` / `Reflect` | Not supported |
| `globalThis` | Not supported |

## Numbers

All numbers are `number` (no separate integer type). Integer literal expressions use native 64-bit integer instructions — `42 + 10` compiles to `add i64` rather than `fadd double`. Division always returns a float. Variables are stored as doubles.

## Strings

Strings are null-terminated C strings, not JavaScript's UTF-16 strings. They work fine for ASCII and UTF-8 text but cannot contain embedded null bytes.

## Closures

Arrow functions and nested functions can capture outer variables, but captures are **by value, not by reference**. Mutating a variable after a closure captures it is a **compile error**:

```typescript
let x = 1;
const f = () => console.log(x);
x = 2; // error: variable 'x' is reassigned after being captured by a closure
```

Inline lambdas with captures work in array methods:

```typescript
const offset = 10;
const result = [1, 2, 3].map(x => x + offset); // [11, 12, 13]
```
