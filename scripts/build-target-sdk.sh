#!/usr/bin/env bash
# Packages a target SDK tarball for cross-compilation.
# Runs on CI after build-vendor.sh. Copies vendor .a files, C bridge .o files,
# and (on Alpine/musl) the sysroot into a tarball that can be downloaded with
# `chad target add <name>`.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR_DIR="$REPO_DIR/vendor"
C_BRIDGES_DIR="$REPO_DIR/c_bridges"

# Detect platform
UNAME_S=$(uname -s)
UNAME_M=$(uname -m)

if [ "$UNAME_S" = "Darwin" ]; then
  TARGET_OS="macos"
elif [ "$UNAME_S" = "Linux" ]; then
  TARGET_OS="linux"
else
  echo "Unsupported OS: $UNAME_S"
  exit 1
fi

if [ "$UNAME_M" = "x86_64" ]; then
  TARGET_ARCH="x64"
  LLVM_ARCH="x86_64"
elif [ "$UNAME_M" = "aarch64" ] || [ "$UNAME_M" = "arm64" ]; then
  TARGET_ARCH="arm64"
  LLVM_ARCH="aarch64"
else
  echo "Unsupported arch: $UNAME_M"
  exit 1
fi

TARGET_NAME="${TARGET_OS}-${TARGET_ARCH}"

# Detect libc (musl vs glibc on Linux)
LIBC="system"
TRIPLE=""
if [ "$TARGET_OS" = "linux" ]; then
  if ldd --version 2>&1 | grep -qi musl; then
    LIBC="musl"
    TRIPLE="${LLVM_ARCH}-unknown-linux-musl"
  else
    LIBC="gnu"
    TRIPLE="${LLVM_ARCH}-unknown-linux-gnu"
  fi
elif [ "$TARGET_OS" = "macos" ]; then
  TRIPLE="${LLVM_ARCH}-apple-darwin"
fi

echo "==> Building target SDK: ${TARGET_NAME}"
echo "    Triple: ${TRIPLE}"
echo "    Libc: ${LIBC}"

SDK_DIR="$REPO_DIR/.sdk-staging/${TARGET_NAME}"
rm -rf "$SDK_DIR"
mkdir -p "$SDK_DIR/vendor" "$SDK_DIR/bridges"

# Copy vendor libraries
echo "  Copying vendor libraries..."
cp "$VENDOR_DIR/bdwgc/libgc.a" "$SDK_DIR/vendor/"
cp "$VENDOR_DIR/yyjson/libyyjson.a" "$SDK_DIR/vendor/"
cp "$VENDOR_DIR/libuv/build/libuv.a" "$SDK_DIR/vendor/"
cp "$VENDOR_DIR/picohttpparser/picohttpparser.o" "$SDK_DIR/vendor/"
if [ -f "$VENDOR_DIR/tree-sitter/libtree-sitter.a" ]; then
  cp "$VENDOR_DIR/tree-sitter/libtree-sitter.a" "$SDK_DIR/vendor/"
fi

# Copy tree-sitter TypeScript objects if they exist
if [ -d "$REPO_DIR/build" ]; then
  for obj in tree-sitter-typescript-parser.o tree-sitter-typescript-scanner.o; do
    if [ -f "$REPO_DIR/build/$obj" ]; then
      cp "$REPO_DIR/build/$obj" "$SDK_DIR/vendor/"
    fi
  done
  if [ -f "$REPO_DIR/build/treesitter-bridge.o" ]; then
    cp "$REPO_DIR/build/treesitter-bridge.o" "$SDK_DIR/bridges/"
  fi
fi

# Copy C bridge object files
echo "  Copying bridge objects..."
for bridge in child-process-bridge.o os-bridge.o regex-bridge.o dotenv-bridge.o watch-bridge.o lws-bridge.o child-process-spawn.o; do
  if [ -f "$C_BRIDGES_DIR/$bridge" ]; then
    cp "$C_BRIDGES_DIR/$bridge" "$SDK_DIR/bridges/"
  fi
done

# On musl Linux: copy sysroot (headers + libc.a + crt objects)
# This gives cross-compilers everything they need to produce static musl binaries
if [ "$LIBC" = "musl" ]; then
  echo "  Copying musl sysroot..."
  mkdir -p "$SDK_DIR/sysroot/include" "$SDK_DIR/sysroot/lib"

  # Copy musl headers
  if [ -d /usr/include ]; then
    cp -r /usr/include/* "$SDK_DIR/sysroot/include/"
  fi

  # Copy essential musl libraries and CRT objects
  for lib in libc.a libm.a libpthread.a librt.a libdl.a crt1.o crti.o crtn.o Scrt1.o rcrt1.o; do
    if [ -f "/usr/lib/$lib" ]; then
      cp "/usr/lib/$lib" "$SDK_DIR/sysroot/lib/"
    fi
  done

  # Copy gcc/musl support libraries
  for lib in libgcc.a libgcc_eh.a; do
    found=$(find /usr/lib/gcc -name "$lib" 2>/dev/null | head -1)
    if [ -n "$found" ]; then
      cp "$found" "$SDK_DIR/sysroot/lib/"
    fi
  done
fi

# Write sdk.json metadata
VERSION="0.1.0"
if [ -f "$REPO_DIR/package.json" ]; then
  VERSION=$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "0.1.0")
fi

cat > "$SDK_DIR/sdk.json" <<EOF
{
  "version": "${VERSION}",
  "triple": "${TRIPLE}",
  "os": "${TARGET_OS}",
  "arch": "${TARGET_ARCH}",
  "libc": "${LIBC}"
}
EOF

# Create tarball — contents are at the top level (vendor/, bridges/, sdk.json)
TARBALL="$REPO_DIR/chadscript-target-${TARGET_NAME}.tar.gz"
echo "  Creating tarball: $TARBALL"
tar -czf "$TARBALL" -C "$SDK_DIR" .

# Show what we built
echo ""
echo "Target SDK '${TARGET_NAME}' built successfully"
echo "  Tarball: $TARBALL"
echo "  Size: $(du -h "$TARBALL" | cut -f1)"
ls -la "$SDK_DIR/vendor/"
ls -la "$SDK_DIR/bridges/"
if [ -d "$SDK_DIR/sysroot" ]; then
  echo "  Sysroot: $(du -sh "$SDK_DIR/sysroot" | cut -f1)"
fi
