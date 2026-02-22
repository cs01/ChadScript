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

### `chad init`

Generate type definitions and a starter project in the current directory.

```bash
chad init
```

Creates `chadscript.d.ts` (type declarations for editor support), `tsconfig.json`, and `hello.ts`. Run this once per project so your editor knows about ChadScript's built-in APIs.

### `chad clean`

Remove the `.build` directory.

```bash
chad clean
```

## Options

| Option | Description |
|--------|-------------|
| `-o <output>` | Specify output file path (default: `.build/<input>`) |
| `--target <target>` | Cross-compile for a different platform (see below) |
| `-v`, `--verbose` | Show compilation steps |
| `-g` | Emit DWARF debug info for source-level debugging with gdb/lldb |
| `--emit-llvm`, `-S` | Output LLVM IR only (no binary) |
| `--keep-temps` | Keep intermediate files (`.ll`, `.o`) |
| `-fsanitize=address` | Build with AddressSanitizer (ASAN) |

## Cross-Compilation

Build binaries for a different platform than the one you're running on:

```bash
chad build app.ts --target macos-arm64    # Build for Apple Silicon Mac
chad build app.ts --target linux-x64      # Build for Linux x86-64
chad build app.ts --target linux-arm64    # Build for Linux ARM64
chad build app.ts --target macos-x64      # Build for Intel Mac
```

The compiler handles setting the correct LLVM target triple, linker flags, and platform-specific symbols (like `process.platform`) automatically.
