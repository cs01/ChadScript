# CLI Reference

```
chad <command> [options] <file>
```

## Commands

| Command | Description |
|---------|-------------|
| `chad build <file>` | Compile to a native binary (output: `.build/<name>`) |
| `chad run <file>` | Compile and immediately run |
| `chad watch <file>` | Watch for changes, recompile and re-run on save |
| `chad init` | Generate `chadscript.d.ts`, `tsconfig.json`, and a starter file for editor support |
| `chad clean` | Remove the `.build` directory |
| `chad ir <file>` | Emit LLVM IR without compiling — useful for debugging codegen |
| `chad target` | Manage cross-compilation SDKs (`list`, `add <target>`, `remove <target>`) |

## Options

| Option | Description |
|--------|-------------|
| `-o <output>` | Output file path |
| `--target <target>` | Cross-compile for a different platform |
| `-v`, `--verbose` | Show compilation steps |
| `-g` | Emit DWARF debug info for use with gdb/lldb |
| `--keep-temps` | Keep intermediate `.ll` and `.o` files |
| `--link-obj <path>` | Link an external object file or static library (repeatable) |
| `-fsanitize=address` | Build with AddressSanitizer |

## Cross-Compilation

```bash
chad target add linux-x64        # install the SDK (one-time)
chad build app.ts --target linux-x64
```

Only `linux-x64` is currently supported as a cross-compile target. SDKs are installed to `~/.chadscript/targets/`.
