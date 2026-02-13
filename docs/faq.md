# FAQ

## What is ChadScript?

ChadScript is a compiler that takes TypeScript source code and produces native ELF binaries via LLVM. It is not a runtime, interpreter, or transpiler. The output is a standalone executable with no dependencies on Node.js, V8, or any JavaScript engine.

## Is ChadScript a drop-in replacement for TypeScript?

No. ChadScript uses TypeScript syntax but has different semantics. It compiles to native machine code with fixed types and limits to dynamic features. See [Limitations](/language/limitations) for the full list.

## What TypeScript features are supported?

Most of the core language: variables, functions, classes, interfaces, arrays, strings, `for`/`while` loops, `if`/`else`, `switch`, template literals, destructuring, spread, `async`/`await`, `Map`, `Set`, `RegExp`, and more. See the [Standard Library](/stdlib/) for supported APIs.

## What TypeScript features are NOT supported?

- `eval()` and dynamic code execution
- `any`, `unknown`, and union types like `string | number`
- Optional chaining (`?.`)
- `instanceof`, `for...in`, and runtime type inspection
- User-defined generics (built-in generics like `Map<K,V>` work)
- Closures over mutable variables
- Decorators, symbols, and reflection

See [Limitations](/language/limitations) for the complete list.

## How fast is it?

ChadScript binaries start in ~1.9ms (vs ~65ms for Node.js, ~20ms for Bun). See [Benchmarks](/benchmarks) for detailed numbers.

## What platforms are supported?

Linux x86-64 and macOS. The compiler produces ELF binaries and links against system libraries (libgc, libuv, libcurl, etc.).

## How does garbage collection work?

ChadScript uses the [Boehm GC](https://www.hboehm.info/gc/) (`libgc`), a conservative garbage collector for C/C++. All heap allocations go through `GC_malloc`. You don't need to manage memory manually.

## Can I use npm packages?

Yes, as long as the package meets the standards that ChadScript requires: fully typed and limits to dynamic features. In practice this likely means most packages will not work out of the box.

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

Yes. The compiler (~45k lines of TypeScript) can compile itself to a native binary. The native binary can then compile the compiler again, proving correctness. See [Architecture](/language/architecture) for details on the self-hosting pipeline.

## How are types represented at runtime?

Every TypeScript type maps to a fixed LLVM type: `number` is `double`, `string` is `i8*` (C string), `boolean` is `double`, arrays are structs with a pointer, length, and capacity. There is no boxing, no type tags, and no runtime type checks. See [Type Mappings](/language/type-mappings).

## Can I call C libraries?

ChadScript links against C libraries directly. The standard library (fs, crypto, sqlite, fetch, http) is implemented by calling C APIs inline. There is no FFI bridge — calls to `sqlite3_exec` or `curl_easy_perform` compile to direct native calls with zero overhead.

## How do I build and run a program?

```bash
chad build myfile.ts -o myprogram
./myprogram
```

See [Quick Start](/getting-started/quickstart) for a full walkthrough.
