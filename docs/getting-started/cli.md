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

### `chad watch <file>`

Watch a source file for changes and automatically recompile + re-run. Uses `inotify` on Linux (event-based) for instant change detection.

```bash
chad watch server.ts            # Recompiles and re-runs on every save
```

- On file change: kills the running process, recompiles, re-runs
- Compile errors don't crash the loop — keeps watching
- Ctrl+C exits cleanly (kills child process)

### `chad clean`

Remove the `.build` directory.

```bash
chad clean
```

### `chad target`

Manage cross-compilation target SDKs. Target SDKs contain pre-built vendor libraries, C bridge objects, and (for Linux musl targets) a sysroot — everything needed to link a binary for a different platform.

```bash
chad target list              # Show installed SDKs and host info
chad target add linux-x64     # Download and install the Linux x64 SDK
chad target remove linux-x64  # Remove an installed SDK
```

SDKs are installed to `~/.chadscript/targets/<name>/`.

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

Build binaries for a different platform than the one you're running on. Cross-compilation requires a target SDK — pre-built vendor libraries and C bridge objects for the target platform.

### Setup (one-time)

```bash
chad target add linux-x64     # Download the Linux x64 target SDK
```

This downloads pre-built libraries (libgc, libuv, yyjson, C bridges, and a musl sysroot) from GitHub Releases and installs them to `~/.chadscript/targets/linux-x64/`.

### Build for another platform

```bash
chad build app.ts --target linux-x64      # Build for Linux x86-64
chad build app.ts --target linux-arm64    # Build for Linux ARM64
chad build app.ts --target macos-arm64    # Build for Apple Silicon Mac
chad build app.ts --target macos-x64      # Build for Intel Mac
```

The compiler handles setting the correct LLVM target triple, linker flags, and platform-specific symbols (like `process.platform`) automatically.

### How it works

When you pass `--target`, the compiler:

1. Generates LLVM IR with the target's triple and data layout
2. Assembles the IR to a target-platform object file using `llc`
3. Links against pre-built libraries from the target SDK instead of the host's local libraries
4. For Linux musl targets: automatically passes `--sysroot` and `-static` to produce a fully static binary that runs on any Linux distribution

### Supported targets

| Target | Triple | Notes |
|--------|--------|-------|
| `linux-x64` | `x86_64-unknown-linux-musl` | Static musl binary, runs anywhere |
| `linux-arm64` | `aarch64-unknown-linux-musl` | Static musl binary for ARM64 |
| `macos-arm64` | `aarch64-apple-darwin` | Apple Silicon |
| `macos-x64` | `x86_64-apple-darwin` | Intel Mac |

### Limitations

- **macOS from Linux**: Apple's license prohibits redistributing macOS SDK files, so `chad target add macos-arm64` on Linux will print instructions for using [osxcross](https://github.com/tpoechtrager/osxcross) instead.
- **macOS to Linux**: Works out of the box — this is the common deployment path.
