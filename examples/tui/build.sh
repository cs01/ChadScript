#!/bin/bash
# Build the ChadScript TUI demos (Zireael-powered terminal apps).
#
# This uses `chad build` with --link-obj/--link-path/--link-lib to compile
# the TypeScript apps, link the C bridge, and produce native binaries.
#
# Usage: bash examples/tui/build.sh
# Run:   .build/examples/tui/app       (imperative)
#        .build/examples/tui/app-jsx   (JSX)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ZIREAEL_DIR="${ZIREAEL_DIR:?Set ZIREAEL_DIR to point to your Zireael checkout}"
ZIREAEL_LIB="$ZIREAEL_DIR/out/build/posix-clang-release/libzireael.a"
ZIREAEL_INCLUDE="$ZIREAEL_DIR/include"
BRIDGE_SRC="$SCRIPT_DIR/zireael-bridge.c"
BRIDGE_OBJ="$SCRIPT_DIR/zireael-bridge.o"

# --- Step 1: Build Zireael if needed ---
if [ ! -f "$ZIREAEL_LIB" ]; then
  echo "Building Zireael..."
  (cd "$ZIREAEL_DIR" && cmake --preset posix-clang-release && cmake --build --preset posix-clang-release)
fi

# --- Step 2: Compile the C bridge ---
echo "Compiling zireael-bridge.c..."
clang -c -O2 -fPIC \
  -I "$ZIREAEL_INCLUDE" \
  "$BRIDGE_SRC" \
  -o "$BRIDGE_OBJ"

# --- Step 3: Build the apps with chad ---
cd "$REPO_DIR"

# Use node compiler — the native compiler has a known codegen bug with
# declare function (Heisenbug in generateDeclareFunction). Use node for now.
CHAD="node dist/chad-node.js"

echo "Building app.tsx..."
$CHAD build examples/tui/app.tsx \
  -o .build/examples/tui/app \
  --link-obj "$BRIDGE_OBJ,$ZIREAEL_LIB" \
  --link-lib pthread

echo "Building app-jsx.tsx..."
$CHAD build examples/tui/app-jsx.tsx \
  -o .build/examples/tui/app-jsx \
  --link-obj "$BRIDGE_OBJ,$ZIREAEL_LIB" \
  --link-lib pthread

echo ""
echo "Built: .build/examples/tui/app       (imperative)"
echo "       .build/examples/tui/app-jsx   (JSX)"
echo "Run:   .build/examples/tui/app"
echo "       .build/examples/tui/app-jsx"
