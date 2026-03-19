#!/usr/bin/env bash
# Packages a target SDK tarball for cross-compilation.
# Runs on CI after build-vendor.sh. Copies vendor .a files and C bridge .o files
# into a tarball that can be downloaded with `chad target add <name>`.
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
TRIPLE="${LLVM_ARCH}-unknown-linux-gnu"
if [ "$TARGET_OS" = "macos" ]; then
  TRIPLE="${LLVM_ARCH}-apple-darwin"
fi

echo "==> Building target SDK: ${TARGET_NAME}"
echo "    Triple: ${TRIPLE}"

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
for bridge in child-process-bridge.o os-bridge.o strlen-cache.o time-bridge.o base64-bridge.o url-bridge.o uri-bridge.o regex-bridge.o dotenv-bridge.o watch-bridge.o lws-bridge.o multipart-bridge.o child-process-spawn.o arena-bridge.o curl-bridge.o compress-bridge.o yaml-bridge.o llvm-bridge.o llvm-builder-bridge.o lld-bridge.o; do
  if [ -f "$C_BRIDGES_DIR/$bridge" ]; then
    cp "$C_BRIDGES_DIR/$bridge" "$SDK_DIR/bridges/"
  fi
done

# Package sysroot for Linux targets (needed when cross-compiling from macOS).
# Includes CRT startup objects, system libraries, and GCC support files that
# the linker needs to produce a working ELF binary.
if [ "$TARGET_OS" = "linux" ]; then
  SYSROOT_DIR="$SDK_DIR/sysroot"
  mkdir -p "$SYSROOT_DIR/usr/lib"

  # Find the system lib directory: multiarch (Debian/Ubuntu), lib64, or /usr/lib
  MULTIARCH_DIR="/usr/lib/${UNAME_M}-linux-gnu"
  if [ ! -d "$MULTIARCH_DIR" ]; then
    MULTIARCH_DIR="/usr/lib64"
  fi
  if [ ! -d "$MULTIARCH_DIR" ]; then
    MULTIARCH_DIR="/usr/lib"
  fi

  # On modern Ubuntu, .a files can be linker scripts with absolute paths
  # (e.g. libm.a contains: GROUP ( /usr/lib/.../libm-2.39.a /usr/lib/.../libmvec.a )).
  # This function copies the actual archives and rewrites scripts with local paths.
  copy_sysroot_lib() {
    local src="$1"
    local dst_dir="$2"
    local name=$(basename "$src")
    # Real archives start with "!<arch>" — copy directly
    if head -c7 "$src" 2>/dev/null | grep -q '!<arch>'; then
      cp "$src" "$dst_dir/"
      return
    fi
    # Linker script — copy all referenced .a files, then rewrite with local paths
    for ref in $(grep -o '/[^ )"]*\.a' "$src" 2>/dev/null); do
      [ -f "$ref" ] && cp -n "$ref" "$dst_dir/"
    done
    # Strip directory paths, drop AS_NEEDED blocks (shared lib refs not needed for -static)
    sed -e 's|/[^ )]*\/||g' -e 's|AS_NEEDED ( [^)]* )||g' "$src" > "$dst_dir/$name"
  }

  if [ -d "$MULTIARCH_DIR" ]; then
    echo "  Copying sysroot from $MULTIARCH_DIR..."
    # CRT startup objects — crt1.o is for static linking, Scrt1.o for PIE/shared
    for crt in crt1.o Scrt1.o crti.o crtn.o; do
      [ -f "$MULTIARCH_DIR/$crt" ] && cp "$MULTIARCH_DIR/$crt" "$SYSROOT_DIR/usr/lib/"
    done
    # System libraries — use copy_sysroot_lib to handle linker scripts
    for lib in libc.a libm.a libdl.a librt.a libpthread.a libc_nonshared.a libmvec.a; do
      [ -f "$MULTIARCH_DIR/$lib" ] && copy_sysroot_lib "$MULTIARCH_DIR/$lib" "$SYSROOT_DIR/usr/lib/"
    done
  fi

  # GCC support objects and libraries (crtbeginS.o, crtendS.o, libgcc.a, libgcc_s.so)
  GCC_DIR=$(find /usr/lib/gcc/${UNAME_M}-linux-gnu -maxdepth 1 -type d 2>/dev/null | sort -V | tail -1)
  if [ -n "$GCC_DIR" ] && [ -d "$GCC_DIR" ]; then
    echo "  Copying GCC support from $GCC_DIR..."
    # crtbeginT.o/crtendT.o for static, crtbeginS.o/crtendS.o for shared/PIE
    for obj in crtbeginT.o crtendT.o crtbeginS.o crtendS.o crtbegin.o crtend.o; do
      [ -f "$GCC_DIR/$obj" ] && cp "$GCC_DIR/$obj" "$SYSROOT_DIR/usr/lib/"
    done
    [ -f "$GCC_DIR/libgcc.a" ] && cp "$GCC_DIR/libgcc.a" "$SYSROOT_DIR/usr/lib/"
    [ -f "$GCC_DIR/libgcc_eh.a" ] && cp "$GCC_DIR/libgcc_eh.a" "$SYSROOT_DIR/usr/lib/"
    # libgcc_s might be a linker script or symlink — copy the actual .so
    for f in $GCC_DIR/libgcc_s.so* /lib/${UNAME_M}-linux-gnu/libgcc_s.so*; do
      [ -f "$f" ] && cp -L "$f" "$SYSROOT_DIR/usr/lib/"
    done
  fi

  echo "  Sysroot contents:"
  ls "$SYSROOT_DIR/usr/lib/"
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
  "libc": "$([ "$TARGET_OS" = "linux" ] && echo "gnu" || echo "system")"
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
