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
| Closures | Supported (capture by value, not by reference) |
| `declare function` (FFI) | Supported (see [FFI](#foreign-function-interface-ffi)) |
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
| Union types (`string \| null`) | Supported (nullable unions only — unsafe unions like `string \| number` are rejected at compile time) |
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

```tsx
interface Props {
  text: string;
  color: number;
}

function createElement(tag: string, props: Props, children: string[]): string {
  // your rendering logic here
  return tag;
}

const ui = <Label text="hello" color={0xff0000} />;
// desugars to: createElement("Label", { text: "hello", color: 0xff0000 }, [])
```

## Foreign Function Interface (FFI)

`declare function` lets you call external C functions with zero-cost type mappings:

```ts
declare function zr_init(): i8_ptr;
declare function zr_draw_text(engine: i8_ptr, x: i32, y: i32, text: i8_ptr, fg: u32, bg: u32): void;
```

FFI type aliases map directly to LLVM types with no double conversion:

| Type Alias | LLVM Type | Description |
|-----------|-----------|-------------|
| `i8`, `i16`, `i32`, `i64` | `i8`, `i16`, `i32`, `i64` | Signed integers |
| `u8`, `u16`, `u32`, `u64` | `i8`, `i16`, `i32`, `i64` | Unsigned integers (same LLVM type) |
| `f32` | `float` | 32-bit float |
| `f64` | `double` | 64-bit float |
| `i8_ptr`, `ptr` | `i8*` | Opaque pointer |

Link external object files with `--link-obj`:

```bash
chad build app.ts -o app --link-obj bridge.o --link-obj /path/to/libfoo.a
```

Linker flags (`-lm`, `-lpthread`, etc.) are auto-detected from linked libraries.

## Dynamic Features

These require runtime code evaluation and are not possible in a native compiler:

| Feature | Why |
|---------|-----|
| `eval()` | No runtime code evaluation |
| `Function()` constructor | No runtime code evaluation |
| `Proxy` / `Reflect` | Require runtime interception |
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

Inline lambdas with captures work in array methods:

```typescript
const offset = 10;
const result = [1, 2, 3].map(x => x + offset); // [11, 12, 13]
```

## npm Compatibility

npm packages work as long as they only use supported TypeScript features.

## Standard Library

Everything is built in — no `npm install` needed:

`ChadScript.embed` · `child_process` · `console` · `crypto` · `Date` · `fetch` · `fs` · `httpServe` · `JSON` · `Map` · `Math` · `os` · `path` · `process` · `RegExp` · `Set` · `sqlite`
