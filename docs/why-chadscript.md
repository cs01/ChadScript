# Why ChadScript?

ChadScript is a systems programming language with three goals: **as fast as C, as safe as Rust, as ergonomic as TypeScript**.

It's not a TypeScript compiler, runtime, or transpiler. It's a new language that uses TypeScript's syntax as its surface — the same parser, the same class and interface shapes, the same `async`/`await` — but compiles to native ELF or Mach-O binaries via LLVM. No Node.js, no JVM, no runtime at all.

## The problem it solves

Systems languages are fast but painful. Scripting languages are ergonomic but slow. The gap between them forces you to choose between esoteric systems languages, or write user friendly interpreted languages for velocity and accept the overhead.

ChadScript's bet: TypeScript syntax is expressive enough to be the surface of a systems language, and a smart compiler can translate it directly to native code without a runtime.

## As fast as C

ChadScript programs compile via LLVM — the same backend used by Clang, Rust, and Swift. The optimizer applies decades of battle-tested passes. Function calls to the standard library are direct native calls into C libraries: `sqlite3_exec`, `curl_easy_perform` — no FFI overhead, no marshalling.

Startup time is as fast as ~2ms.

| Runtime | Startup |
|---------|---------|
| ChadScript | ~2ms |
| Go | ~5ms |
| Bun | ~12ms |
| Node.js | ~65ms |

[See full benchmarks →](/benchmarks)

## As safe as Rust

Rust's safety story is powerful but comes with the borrow checker: a new mental model, lifetime annotations, and a steep learning curve. ChadScript takes a different approach — TypeScript's type system plus a GC — and reaches a comparable safety bar for most real programs, without the complexity.

**Null safety.** In C, `null` is a zero pointer the compiler trusts you to never dereference. In ChadScript, `string` is *never* null. If a value can be absent, its type is `string | null` and the compiler forces you to check before use. This is equivalent to Rust's `Option<T>`, without the wrapping and unwrapping ceremony.

```typescript
function greet(name: string | null): string {
  if (name === null) return "Hello, stranger"
  return `Hello, ${name}`  // name is string here — compiler knows
}
```

**Bounds-checked array access.** Out-of-bounds array reads are a primary source of memory corruption in C. ChadScript's type system flags array access as potentially absent and requires you to handle that case — the same guarantee Rust's `.get()` provides, enforced by the compiler.

**No dangling pointers.** Memory is managed by a garbage collector embedded in the binary. You never call `free`. There are no use-after-free bugs.

**No undefined behavior at the language level.** Closures capture by value; mutating a variable after a closure captures it is a *compile error*, not a silent bug:

```typescript
let x = 1
const f = () => console.log(x)
x = 2  // error: 'x' is reassigned after being captured by a closure
```

**Compile-time type checking.** No `any`, no runtime type inspection. Every value has a known type at compile time. If the code compiles, the types are correct.

**FFI is explicitly unsafe.** ChadScript can call C libraries directly via `declare function` — the same escape hatch Rust provides with `unsafe {}` blocks. Outside of that explicit boundary, the safety guarantees hold.

## As ergonomic as TypeScript

### Familiar syntax

If you write TypeScript today, ChadScript is immediately readable. Classes, interfaces, `async`/`await`, arrow functions, template literals, destructuring, `Map`, `Set`, `for...of` — they all work and look exactly as you'd expect.

```typescript
interface User {
  id: number;
  name: string;
  email: string | null;
}

class UserStore {
  private users: Map<number, User> = new Map()

  add(user: User): void {
    this.users.set(user.id, user)
  }

  find(id: number): User | null {
    return this.users.get(id) ?? null
  }
}
```

This compiles to a native binary. No runtime. The `Map` is a C struct under the hood.

### IDE support

Run `chad init` in your project to generate a `tsconfig.json` that points your editor at ChadScript's type definitions. You get full autocomplete, go-to-definition, and inline error highlighting in VS Code — the same experience as writing TypeScript.

### Batteries included

No `npm install`. Everything you'd reach for npm for ships with the compiler, backed by proven C libraries with zero overhead:

| You write | Backed by |
|-----------|-----------|
| `fetch('https://...')` | libcurl |
| `sqlite.open('db.sqlite')` | SQLite |
| `crypto.sha256(data)` | OpenSSL |
| `httpServe(...)` | libwebsockets |
| `JSON.parse<T>(str)` | yyjson |
| `fs.readFile(path)` | libc |

No wrappers, no reflection. The compiler generates direct calls to the C API.

### Single-binary deploy

```bash
chad build app.ts -o app
scp app user@server:/usr/local/bin/
```

That's it. No Docker required for the application itself (though you can if you want). No Node.js version mismatches. No `node_modules` to sync. One file.

You can even embed static assets at compile time:

```typescript
const html = ChadScript.embed('./public/index.html')  // compiled in as a string constant
```

### LLM-friendly

TypeScript is the language LLMs generate most fluently — it's massively overrepresented in training data. ChadScript inherits this: ask any model to write a ChadScript HTTP server or SQLite query and it will produce working code on the first try. The static type system means the model's output is more likely to be correct; the types serve as inline documentation for what each value is.

## vs Node.js / Bun / Deno

The JS runtimes are excellent for web applications. ChadScript targets the use cases where a runtime is a liability:

- **CLI tools** — a 65ms startup penalty is user-visible. A 2ms startup isn't.
- **System services** — no runtime to maintain, no version to pin, no cold start in containers.
- **Single-binary distribution** — `chad build app.ts -o app` produces one file you can `scp` anywhere.
- **Resource-constrained environments** — lower memory footprint, no JIT heap.

## vs Rust

Rust is a great language. ChadScript is for teams who want native performance but aren't ready to invest in learning the borrow checker. If your team knows TypeScript, ChadScript has a near-zero learning curve for the syntax. The trade-off: you get a GC instead of zero-cost ownership. For most applications, GC pauses are not a problem.

If you need zero GC pauses or are writing an OS kernel, use Rust.

## vs Go

Go is close in philosophy — garbage collected, fast startup, single-binary deploy. The main difference is syntax and ecosystem. ChadScript uses TypeScript syntax, which means better IDE tooling (the TS language server works on `.ts` files), better LLM code generation, and a shallower learning curve for the majority of developers who already know TypeScript.

## vs C

C gives you maximum control and maximum footguns. No null safety. No GC. Manual memory management. ChadScript compiles to code as fast as C (same LLVM backend) while preventing the class of bugs that C programs routinely suffer: null dereferences, use-after-free, uninitialized reads.

---

## Real-world proof

The compiler itself is the proof of concept. ChadScript is self-hosting: the ~45k-line TypeScript compiler compiles itself to a native binary. That binary can then compile the compiler again. If the language couldn't handle real programs, it couldn't compile itself.

The [Hacker News clone](https://github.com/cs01/ChadScript/tree/main/examples/hackernews) is a practical example: SQLite database, HTTP server, embedded HTML/CSS/JS assets, JSON API — all in one TypeScript file, shipping as a single binary.

---

## Get started

```bash
curl -fsSL https://raw.githubusercontent.com/cs01/ChadScript/main/install.sh | sh
chad run examples/hello.ts
```

→ [Installation](/getting-started/installation)
→ [Quickstart](/getting-started/quickstart)
→ [Supported Features](/language/features)
