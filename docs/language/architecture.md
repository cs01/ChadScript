# About ChadScript

ChadScript is an ahead-of-time TypeScript compiler that produces standalone native binaries. Write standard TypeScript, run `chad build`, and get an ELF or Mach-O binary that starts in under 2ms — no Node.js, no JVM, no runtime VM. The compiler is self-hosting: it is written in TypeScript and compiles itself to a native binary.

It targets a practical subset of TypeScript where all types are known at compile time. This has a nice side effect: the supported language is simpler and easier to reason about. Like C++ has a "safe subset" that avoids its footguns, ChadScript is a safe subset of TypeScript — you get the familiar syntax without the dynamic corners that make large codebases hard to follow. See [Supported Features](/language/limitations) for the full feature list.

## How It Compiles Your Code

When you run `chad build app.ts -o app`, the compiler parses your TypeScript into an AST, resolves every type, lowers the AST to LLVM IR, then hands off to `opt` (LLVM's optimizer), `llc` (LLVM's object code generator), and `clang` (linker) to produce the final binary. The output is a standard ELF binary (Linux) or Mach-O binary (macOS) — run it, deploy it, or ship it like any other native program.

### LLVM IR

The core of the compiler is a code generator that emits [LLVM Intermediate Representation](https://llvm.org/docs/LangRef.html). LLVM IR is the same intermediate format used by Clang (C/C++), Rust, Swift, and Kotlin Native. It's a typed, register-based assembly language that sits one level above machine code: it describes operations like loads, stores, arithmetic, and function calls without committing to a specific CPU instruction set.

From LLVM IR, LLVM's optimizer and backend produce tight native machine code for x86-64, ARM64, or any other LLVM target. This means ChadScript gets decades of battle-tested optimization passes for free.

Here's what `console.log("Hello, World!")` compiles to:

```llvm
@str.0 = private constant [14 x i8] c"Hello, World!\00"
@fmt.1 = private constant [4 x i8]  c"%s\0A\00"         ; "%s\n"

define i32 @main() {
entry:
  %0 = getelementptr [14 x i8], [14 x i8]* @str.0, i64 0, i64 0
  %1 = getelementptr [4 x i8],  [4 x i8]*  @fmt.1, i64 0, i64 0
  %2 = call i32 (i8*, ...) @printf(i8* %1, i8* %0)
  %3 = call i32 @fflush(i8* null)
  ret i32 0
}

declare i32 @printf(i8*, ...)
declare i32 @fflush(i8*)
```

The string literal is a global constant. `getelementptr` produces a pointer to its first byte. `call` invokes C's `printf` directly — no VM, no dispatch table, no boxing. The `declare` lines tell LLVM the type signatures of external C functions; the actual implementations come from libc at link time.

## Types and Semantics

TypeScript (and JavaScript) has a single `number` type — a 64-bit IEEE 754 float. ChadScript preserves this at the source level, but the compiler is smart about it: integer literals (`42`, `0xFF`) compile to native 64-bit integer registers; fractional values (`3.14`) use 64-bit doubles. Integer arithmetic (`+`, `-`, `*`, `%`) between integers stays in integer registers — no floating-point overhead. Division always returns a float. This is automatic and invisible.

This matters because LLVM distinguishes the two: `add i64 %a, %b` is an integer add, `fadd double %a, %b` is a floating-point add. Getting the right instruction means you pay for the operation you actually need.

**Null safety.** In C, `null` is just a zero-valued pointer. Dereferencing it is undefined behavior — the compiler trusts you, and if you're wrong you get a segfault or worse. In TypeScript (and ChadScript), `null` is a value that must be explicitly included in a type: `string | null`. If a variable is typed `string`, the type checker guarantees it is never null before it's used. The compiled output is still a pointer under the hood, but the type system prevents the class of bugs C can't catch. You get the safety of TypeScript's type model with the performance profile of C.

**Why this works well for LLMs.** TypeScript is one of the most widely represented languages in public training data — models know it well and generate it fluently. A safe, statically-typed subset means LLM-generated code is more likely to be correct: the types act as inline documentation telling both the compiler and the model what each value is. Simpler semantics (no `eval`, no `Proxy`, no runtime type mutation) mean programs are shorter and more predictable — fewer edge cases to reason about, fewer tokens needed to express intent, better output.

## The Runtime

ChadScript programs are statically linked against C libraries so the binary has access to networking, databases, file I/O, crypto, and more with no external runtime. The libraries ship with the compiler and are bundled into the output at link time — the result is a single self-contained file.

LLVM IR calls into C libraries using their native ABI — no FFI wrapper, no marshalling overhead. The `declare` + `call` pattern you saw above works for any C function:

```llvm
; Declare the C function signature so LLVM knows how to call it
declare i32 @sqlite3_open(i8*, i8**)

; Call it just like any other function
%rc = call i32 @sqlite3_open(i8* %path, i8** %db_out)
```

The linker resolves the symbol at build time. At runtime there is nothing dynamic — the address is baked into the binary.

## Platform Support

- **Linux x86-64** — primary target
- **Linux ARM64** — supported
- **macOS ARM64** — supported (Apple Silicon)
- **macOS x64** — supported (Intel)

Cross-compilation is supported — see the [CLI reference](../getting-started/cli.md#cross-compilation) for details.
