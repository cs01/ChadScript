# CLI Reference

```
chad <command> [options] <file>
```

## Commands

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

### `chad watch <file>`

Watch a source file for changes and automatically recompile + re-run. Uses `inotify` on Linux and `kqueue` on macOS for event-based change detection.

```bash
chad watch server.ts            # Recompiles and re-runs on every save
```

- On file change: kills the running process, recompiles, re-runs
- Compile errors don't crash the loop — keeps watching
- Ctrl+C exits cleanly (kills child process)

## Project

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

## Advanced

### `chad ir <file>`

Emit LLVM IR without compiling to a binary. Useful for debugging codegen.

```bash
chad ir hello.ts                 # Prints LLVM IR to stdout
chad ir hello.ts > hello.ll      # Save to file
```

### `chad target`

Manage cross-compilation target SDKs. Target SDKs contain pre-built vendor libraries, C bridge objects, and a glibc sysroot — everything needed to link a binary for a different platform.

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
| `-g` | Emit DWARF debug info for source-level debugging with gdb/lldb (also skips stripping) |
| `--emit-llvm`, `-S` | Output LLVM IR only (no binary) |
| `--keep-temps` | Keep intermediate files (`.ll`, `.o`) |
| `-fsanitize=address` | Build with AddressSanitizer (ASAN) |
| `--link-obj <path>` | Link an external object file or static library (repeatable) |

## Cross-Compilation

Build binaries for a different platform than the one you're running on. Cross-compilation requires a target SDK — pre-built vendor libraries and C bridge objects for the target platform.

### Setup (one-time)

```bash
chad target add linux-x64     # Download the Linux x64 target SDK
```

This downloads pre-built libraries (libgc, libuv, yyjson, C bridges, and a glibc sysroot) from GitHub Releases and installs them to `~/.chadscript/targets/linux-x64/`.

### Build for another platform

```bash
chad build app.ts --target linux-x64      # Build for Linux x86-64
```

The `--target` flag is currently supported for `build` and `run` commands with `linux-x64` as the only cross-compile target. `chad ir` can target any platform since it only emits LLVM IR.

The compiler handles setting the correct LLVM target triple, linker flags, and platform-specific symbols (like `process.platform`) automatically.

### How it works

When you pass `--target`, the compiler:

1. Generates LLVM IR with the target's triple and data layout
2. Assembles the IR to a target-platform object file using `llc`
3. Links against pre-built libraries from the target SDK instead of the host's local libraries
4. Automatically passes `-static` and `-L<sysroot>/usr/lib` to produce a statically-linked binary

### Supported targets

| Target | Triple | Notes |
|--------|--------|-------|
| `linux-x64` | `x86_64-unknown-linux-gnu` | Static glibc binary |

### Adding extra libraries

The target SDK includes libgc, libuv, and yyjson, but not system libs like libsqlite3, libz, or libzstd. If your app links against these, you need to provide linux-x64 static builds and drop them into the SDK vendor directory at `~/.chadscript/targets/linux-x64/vendor/`.

A convenient way to get them is to pull them from a throwaway Linux container:

```bash
podman run --rm -v ~/.chadscript/targets/linux-x64/vendor:/output:z ubuntu:22.04 bash -c "
  apt-get update -qq &&
  apt-get install -y -qq zlib1g-dev libzstd-dev libsqlite3-dev &&
  cp /usr/lib/x86_64-linux-gnu/libz.a /output/ &&
  cp /usr/lib/x86_64-linux-gnu/libzstd.a /output/ &&
  cp /usr/lib/x86_64-linux-gnu/libsqlite3.a /output/"
```

Docker works the same way — just swap `podman` for `docker` and drop the `:z` volume flag.

### Limitations

- **macOS to Linux** is the primary cross-compilation path (e.g., develop on Mac, deploy to Linux)
- Other target combinations (linux-arm64, macos-arm64, macos-x64) are not yet supported for `build`/`run` but can be targeted with `chad ir`
