# Debugging

ChadScript supports DWARF debug info via the `-g` flag, enabling source-level debugging with GDB or LLDB — including full VS Code integration.

## Compiling with Debug Info

```bash
chad build -g hello.ts -o myapp
```

The `-g` flag embeds source file paths, line numbers, and function names into the binary. This lets debuggers map machine instructions back to your TypeScript source.

## Debugging in VS Code

VS Code can debug ChadScript binaries using either GDB or LLDB through the appropriate extension.

### Setup

Install one of these extensions:

- **Linux**: [C/C++ (ms-vscode.cpptools)](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools) — uses GDB
- **macOS**: [CodeLLDB (vadimcn.vscode-lldb)](https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb) — uses LLDB

### Launch Configuration

Create `.vscode/launch.json` in your project:

**Linux (GDB via cpptools):**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug ChadScript",
      "type": "cppdbg",
      "request": "launch",
      "program": "${workspaceFolder}/myapp",
      "args": [],
      "cwd": "${workspaceFolder}",
      "MIMode": "gdb",
      "preLaunchTask": "chad-build",
      "sourceFileMap": {}
    }
  ]
}
```

**macOS (LLDB via CodeLLDB):**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug ChadScript",
      "type": "lldb",
      "request": "launch",
      "program": "${workspaceFolder}/myapp",
      "args": [],
      "cwd": "${workspaceFolder}",
      "preLaunchTask": "chad-build"
    }
  ]
}
```

### Build Task

Add `.vscode/tasks.json` so VS Code rebuilds with debug info before each debug session:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "chad-build",
      "type": "shell",
      "command": "chad build -g hello.ts -o myapp",
      "group": "build"
    }
  ]
}
```

### Using the Debugger

1. Set breakpoints by clicking the gutter next to any line in your `.ts` source file
2. Press **F5** to build and launch
3. VS Code will stop at your breakpoints, showing local variables, call stack, and source context
4. Use the debug toolbar to step over (**F10**), step into (**F11**), step out (**Shift+F11**), or continue (**F5**)

## What Debug Info Includes

- Source file paths and line numbers for every statement
- Function names (mangled with `_cs_` prefix, e.g., `_cs_myFunction`)
- Subprogram metadata for each function

## Tips

- Debug builds are larger and slightly slower than release builds. Only use `-g` when you need to debug.
- ChadScript mangles user function names with a `_cs_` prefix. If a breakpoint on `myFunc` doesn't work, try `_cs_myFunc`.
- The `main` breakpoint hits the C entry point, which sets up GC and calls your top-level code.
- Combine with `--keep-temps` to inspect the generated LLVM IR alongside debugging: `chad build -g --keep-temps hello.ts`.
