# FAQ

## What is ChadScript?

ChadScript is a systems programming language that uses TypeScript syntax and compiles to native ELF binaries via LLVM. The goal: **as typesafe as Rust, as fast as C, as ergonomic as TypeScript**.

It is **not** a TypeScript compiler, runtime, interpreter, or transpiler. It's a new language that shares TypeScript's syntax and feel, but imposes stricter rules required for native compilation — no `any`, no user-defined generics, by-value closures, and interfaces are data-only structs. Think of it as a TypeScript-syntax dialect for systems programming.

The output is a standalone native binary with no dependencies on Node.js, V8, or any JavaScript engine.

## Is ChadScript a drop-in replacement for TypeScript?

No, and it's not trying to be. ChadScript uses TypeScript syntax as its surface language, but it's a different language with different semantics. Code that relies on runtime JS behavior — closures-by-reference, `any`, generics, `instanceof`, npm packages — won't compile. See [Language Support](/language/features) for what works.

## What TypeScript features are supported?

Most of the core language: variables, functions, classes, interfaces, arrays, strings, `for`/`while` loops, `if`/`else`, `switch`, template literals, destructuring, spread, `async`/`await`, `Map`, `Set`, `RegExp`, and more. See the [Standard Library](/stdlib/) for supported APIs.

## What TypeScript features are NOT supported?

- `eval()` and dynamic code execution
- `any`, `unknown`, and mixed union types like `string | number`
- `instanceof` and runtime type inspection
- User-defined generics (built-in generics like `Map<K,V>` work)
- Generators (`function*`, `yield`)
- Decorators, symbols, `Proxy`, `Reflect`
- `WeakMap`, `WeakSet`

See [Language Support](/language/features) for the complete list of what works and what doesn't.

## How fast is it?

ChadScript binaries start in ~1.9ms (vs ~65ms for Node.js, ~20ms for Bun). See [Benchmarks](/benchmarks) for detailed numbers.

## What platforms are supported?

Linux x86-64 and macOS. Cross-compilation is supported via `--target` (e.g. `chad build app.ts --target macos-arm64`). See [CLI Reference](/getting-started/cli) for all targets.

## How does garbage collection work?

ChadScript uses the [Boehm GC](https://www.hboehm.info/gc/) (`libgc`), a conservative garbage collector for C/C++. All heap allocations go through `GC_malloc`. You don't need to manage memory manually.

## Can I use npm packages?

In theory, if a package is pure TypeScript and only uses features ChadScript supports. In practice, most npm packages rely on V8 semantics, dynamic types, or Node APIs that aren't available, so they won't work.

## How do I handle JSON?

ChadScript has built-in JSON support via the cJSON library. Use `JSON.parse<T>(str)` with a type parameter and `JSON.stringify(obj)`:

```typescript
interface Config {
  name: string;
  port: number;
}

const config = JSON.parse<Config>('{"name": "app", "port": 8080}');
console.log(config.name);
```

The compiler generates a type-specific parser at compile time — no runtime reflection needed.

If the runtime type does not match the type parameter, the value will be zeroed out, similar to how Go handles JSON.

## Is ChadScript self-hosting?

Yes. The compiler (~45k lines of TypeScript) can compile itself to a native binary. The native binary can then compile the compiler again, proving correctness. See [How it Works](/language/architecture) for details.

## Can I call C libraries?

ChadScript links against C libraries directly. The standard library (fs, crypto, sqlite, fetch, http) is implemented by calling C APIs inline — calls to `sqlite3_exec` or `curl_easy_perform` compile to direct native calls with zero overhead.

## How do I build and run a program?

```bash
chad build myfile.ts -o myprogram
./myprogram
```

See [Quick Start](/getting-started/quickstart) for a full walkthrough.
