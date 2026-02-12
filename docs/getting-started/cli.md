# CLI Reference

## Commands

```
chad <command> [options] <file>
```

### `chad build <file>`

Compile a TypeScript file to a native binary.

```bash
chad build hello.ts              # Output: .build/hello
chad build hello.ts -o myapp     # Output: myapp
chad build src/main.ts -o app    # Compile from subdirectory
```

### `chad run <file>`

Compile and immediately run the program.

```bash
chad run hello.ts
chad run hello.ts -- arg1 arg2   # Pass arguments to the program
```

### `chad ir <file>`

Emit LLVM IR without compiling to a binary. Useful for debugging codegen.

```bash
chad ir hello.ts                 # Prints LLVM IR to stdout
chad ir hello.ts > hello.ll      # Save to file
```

### `chad clean`

Remove the `.build` directory.

```bash
chad clean
```

## Options

| Option | Description |
|--------|-------------|
| `-o <output>` | Specify output file path (default: `.build/<input>`) |
| `-v`, `--verbose` | Show compilation steps |
| `--debug` | Show internal debugging info |
| `--trace` | Show everything (AST, IR, variable tracking) |
| `--target <triple>` | Cross-compile target (planned) — e.g. `x86_64-linux-gnu`, `aarch64-linux-gnu` |

## Direct Compiler

The bare compiler is also available as `chadc`:

```bash
chadc hello.ts              # same as chad build hello.ts
chadc hello.ts -o myapp     # same as chad build hello.ts -o myapp
```

`chadc` is the compiler binary itself. The `chad` wrapper adds convenience commands like `run`, `ir`, and `clean`.
