# FAQ

## What is ChadScript?

ChadScript is a compiler that takes TypeScript source code and produces native ELF binaries via LLVM. It is not a runtime, interpreter, or transpiler. The output is a standalone executable with no dependencies on Node.js, V8, or any JavaScript engine.

## Is ChadScript a drop-in replacement for TypeScript?

No. ChadScript supports a practical subset of TypeScript. It compiles to native machine code, so all types must be known at compile time and dynamic features like `eval()` aren't available. See [Language Support](/language/limitations) for details.

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

See [Language Support](/language/limitations) for the complete list of what works and what doesn't.

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
