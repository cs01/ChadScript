# TUI Demo (Zireael)

Interactive terminal UI app compiled to a native binary with ChadScript.

Uses [Zireael](https://github.com/nicegraf/Zireael) — a C11 terminal rendering engine with a binary drawlist protocol.

## Prerequisites

- Zireael cloned and built (set `ZIREAEL_DIR` env var to point to it)
- CMake + clang

## Build & Run

```bash
ZIREAEL_DIR=../Zireael bash examples/tui/build.sh
.build/examples/tui/app
```

## Controls

- **UP/DOWN** — increment/decrement counter by 1
- **LEFT/RIGHT** — increment/decrement counter by 10
- **ESC** — quit

## How It Works

```
TypeScript (app.tsx)
    │  declare function zr_*() — typed FFI declarations
    ▼
C bridge (zireael-bridge.c)
    │  builds drawlist byte buffers, parses event batches
    ▼
libzireael.a
    │  diffs framebuffer, flushes terminal escape codes
    ▼
Terminal
```

The `declare function` syntax tells ChadScript to emit correct LLVM IR calls to external C functions. The `--link-obj` flag links the bridge and Zireael library into the final binary.
