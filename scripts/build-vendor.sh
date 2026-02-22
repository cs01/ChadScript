#!/usr/bin/env bash
set -euo pipefail

VENDOR_DIR="$(cd "$(dirname "$0")/.." && pwd)/vendor"
C_BRIDGES_DIR="$(cd "$(dirname "$0")/.." && pwd)/c_bridges"
NPROC=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)

mkdir -p "$VENDOR_DIR"

# --- bdwgc (Boehm GC) ---
if [ ! -f "$VENDOR_DIR/bdwgc/libgc.a" ]; then
  echo "==> Building bdwgc..."
  cd "$VENDOR_DIR"
  if [ ! -d bdwgc ]; then
    git clone --depth 1 https://github.com/ivmai/bdwgc.git
  fi
  cd bdwgc

  # Ensure compiler atomics are used (avoids libatomic_ops dependency)
  if ! grep -q 'CHADSCRIPT_PATCHED' include/private/gcconfig.h; then
    { printf '/* CHADSCRIPT_PATCHED */\n#ifndef GC_BUILTIN_ATOMIC\n#define GC_BUILTIN_ATOMIC 1\n#endif\n'; cat include/private/gcconfig.h; } > /tmp/gcconfig_patched.h
    mv /tmp/gcconfig_patched.h include/private/gcconfig.h
  fi

  mkdir -p build && cd build
  cmake .. \
    -DCMAKE_C_FLAGS="-fPIC" \
    -DBUILD_SHARED_LIBS=OFF \
    -DBUILD_TESTING=OFF \
    -Denable_cplusplus=OFF -Denable_docs=OFF -Dwithout_libatomic_ops=ON
  make -j"$NPROC"
  mkdir -p "$VENDOR_DIR/bdwgc"
  if [ -f libgc.a ]; then
    cp libgc.a "$VENDOR_DIR/bdwgc/"
  else
    find CMakeFiles/gc.dir -name "*.o" -exec ar rcs "$VENDOR_DIR/bdwgc/libgc.a" {} +
  fi
  echo "  -> $VENDOR_DIR/bdwgc/libgc.a"
else
  echo "==> bdwgc already built, skipping"
fi

# --- picohttpparser ---
if [ ! -f "$VENDOR_DIR/picohttpparser/picohttpparser.o" ]; then
  echo "==> Building picohttpparser..."
  cd "$VENDOR_DIR"
  if [ ! -f picohttpparser/picohttpparser.c ]; then
    git clone --depth 1 https://github.com/h2o/picohttpparser.git picohttpparser-src
    mkdir -p picohttpparser
    cp picohttpparser-src/picohttpparser.h picohttpparser-src/picohttpparser.c picohttpparser/
    rm -rf picohttpparser-src
  fi
  cd picohttpparser
  SSE_FLAGS=""
  if [ "$(uname -m)" = "x86_64" ]; then
    SSE_FLAGS="-msse4.2"
  fi
  cc -c -O2 -fPIC $SSE_FLAGS picohttpparser.c -o picohttpparser.o
  echo "  -> $VENDOR_DIR/picohttpparser/picohttpparser.o"
else
  echo "==> picohttpparser already built, skipping"
fi

# --- yyjson ---
if [ ! -f "$VENDOR_DIR/yyjson/libyyjson.a" ]; then
  echo "==> Building yyjson..."
  cd "$VENDOR_DIR"
  if [ ! -d yyjson ]; then
    mkdir -p yyjson
  fi
  if [ ! -f yyjson/yyjson.c ]; then
    git clone --depth 1 https://github.com/ibireme/yyjson.git yyjson-src
    cp yyjson-src/src/yyjson.h yyjson-src/src/yyjson.c yyjson/
    rm -rf yyjson-src
  fi
  cd yyjson
  cc -c -O2 -fPIC yyjson.c -o yyjson.o
  cc -c -O2 -fPIC -I"$VENDOR_DIR/yyjson" "$C_BRIDGES_DIR/yyjson-bridge.c" -o yyjson-bridge.o
  ar rcs libyyjson.a yyjson.o yyjson-bridge.o
  echo "  -> $VENDOR_DIR/yyjson/libyyjson.a"
else
  echo "==> yyjson already built, skipping"
fi

# --- libuv ---
if [ ! -f "$VENDOR_DIR/libuv/build/libuv.a" ]; then
  echo "==> Building libuv..."
  cd "$VENDOR_DIR"
  if [ ! -d libuv ]; then
    git clone --depth 1 https://github.com/libuv/libuv.git
  fi
  mkdir -p libuv/build
  cd libuv/build
  cmake .. \
    -DCMAKE_C_FLAGS="-fPIC" \
    -DBUILD_TESTING=OFF \
    -DLIBUV_BUILD_SHARED=OFF
  make -j"$NPROC"
  echo "  -> $VENDOR_DIR/libuv/build/libuv.a"
else
  echo "==> libuv already built, skipping"
fi

# --- lws-bridge (must come after libuv and picohttpparser) ---
LWS_BRIDGE_SRC="$C_BRIDGES_DIR/lws-bridge.c"
LWS_BRIDGE_OBJ="$C_BRIDGES_DIR/lws-bridge.o"
if [ ! -f "$LWS_BRIDGE_OBJ" ] || [ "$LWS_BRIDGE_SRC" -nt "$LWS_BRIDGE_OBJ" ]; then
  echo "==> Building lws-bridge..."
  EXTRA_CFLAGS=""
  if [ "$(uname)" = "Darwin" ]; then
    BREW_PREFIX=$(brew --prefix 2>/dev/null || echo "/opt/homebrew")
    ZSTD_PREFIX=$(brew --prefix zstd 2>/dev/null || echo "$BREW_PREFIX")
    if [ -f "$ZSTD_PREFIX/include/zstd.h" ]; then
      EXTRA_CFLAGS="-I$ZSTD_PREFIX/include"
    fi
  fi
  cc -c -O2 -fPIC \
    -I"$VENDOR_DIR/libuv/include" \
    -I"$VENDOR_DIR/picohttpparser" \
    $EXTRA_CFLAGS \
    "$LWS_BRIDGE_SRC" -o "$LWS_BRIDGE_OBJ"
  echo "  -> $LWS_BRIDGE_OBJ"
else
  echo "==> lws-bridge already built, skipping"
fi

# --- regex-bridge ---
REGEX_BRIDGE_SRC="$C_BRIDGES_DIR/regex-bridge.c"
REGEX_BRIDGE_OBJ="$C_BRIDGES_DIR/regex-bridge.o"
if [ ! -f "$REGEX_BRIDGE_OBJ" ] || [ "$REGEX_BRIDGE_SRC" -nt "$REGEX_BRIDGE_OBJ" ]; then
  echo "==> Building regex-bridge..."
  cc -c -O2 -fPIC "$REGEX_BRIDGE_SRC" -o "$REGEX_BRIDGE_OBJ"
  echo "  -> $REGEX_BRIDGE_OBJ"
else
  echo "==> regex-bridge already built, skipping"
fi

# --- child-process-bridge ---
CP_BRIDGE_SRC="$C_BRIDGES_DIR/child-process-bridge.c"
CP_BRIDGE_OBJ="$C_BRIDGES_DIR/child-process-bridge.o"
if [ ! -f "$CP_BRIDGE_OBJ" ] || [ "$CP_BRIDGE_SRC" -nt "$CP_BRIDGE_OBJ" ]; then
  echo "==> Building child-process-bridge..."
  cc -c -O2 -fPIC "$CP_BRIDGE_SRC" -o "$CP_BRIDGE_OBJ"
  echo "  -> $CP_BRIDGE_OBJ"
else
  echo "==> child-process-bridge already built, skipping"
fi

# --- tree-sitter ---
if [ ! -f "$VENDOR_DIR/tree-sitter/libtree-sitter.a" ]; then
  echo "==> Building tree-sitter..."
  cd "$VENDOR_DIR"
  if [ ! -d tree-sitter ]; then
    git clone --depth 1 https://github.com/tree-sitter/tree-sitter.git
  fi
  cd tree-sitter
  make -j"$NPROC"
  echo "  -> $VENDOR_DIR/tree-sitter/libtree-sitter.a"
else
  echo "==> tree-sitter already built, skipping"
fi

echo ""
echo "All vendor libraries built successfully in $VENDOR_DIR"
