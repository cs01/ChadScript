# Debugging

ChadScript supports DWARF debug info via the `-g` flag, enabling source-level debugging with `gdb` or `lldb`.

## Compiling with Debug Info

```bash
chad build -g hello.ts
chad build -g hello.ts -o myapp

# Or with the bare compiler:
chadc -g hello.ts -o myapp
```

The `-g` flag embeds source file paths, line numbers, and function names into the binary. This lets debuggers map machine instructions back to your TypeScript source.

## Debugging with GDB

```bash
chad build -g hello.ts -o myapp

gdb ./myapp
```

Common GDB commands:

```
(gdb) break main              # Break at program entry
(gdb) break hello.ts:5        # Break at line 5 of hello.ts
(gdb) run                     # Start the program
(gdb) run arg1 arg2           # Start with arguments
(gdb) next                    # Step over (next line)
(gdb) step                    # Step into function call
(gdb) continue                # Continue to next breakpoint
(gdb) print x                 # Print variable value
(gdb) backtrace               # Show call stack
(gdb) list                    # Show source around current line
(gdb) info locals             # Show all local variables
(gdb) quit                    # Exit
```

## Debugging with LLDB

```bash
chad build -g hello.ts -o myapp

lldb ./myapp
```

Common LLDB commands:

```
(lldb) breakpoint set -n main           # Break at program entry
(lldb) breakpoint set -f hello.ts -l 5  # Break at line 5
(lldb) run                              # Start the program
(lldb) run arg1 arg2                    # Start with arguments
(lldb) next                             # Step over
(lldb) step                             # Step into
(lldb) continue                         # Continue
(lldb) frame variable                   # Show local variables
(lldb) print x                          # Print variable value
(lldb) bt                               # Show call stack
(lldb) quit                             # Exit
```

## What Debug Info Includes

- Source file paths and line numbers for every statement
- Function names (mangled with `_cs_` prefix, e.g., `_cs_myFunction`)
- Subprogram metadata for each function

## Tips

- Debug builds are larger and slightly slower than release builds. Only use `-g` when you need to debug.
- ChadScript mangles user function names with a `_cs_` prefix. If `break myFunc` doesn't work, try `break _cs_myFunc`.
- The `main` breakpoint hits the C entry point, which sets up GC and calls your top-level code.
- Combine with `--keep-temps` to inspect the generated LLVM IR alongside debugging: `chad build -g --keep-temps hello.ts`.
