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
    cd bdwgc
    git clone --depth 1 https://github.com/ivmai/libatomic_ops.git
  else
    cd bdwgc
  fi
  ./autogen.sh
  ./configure --enable-static --disable-shared --with-pic
  make -j"$NPROC"
  cp .libs/libgc.a . 2>/dev/null || true
  echo "  -> $VENDOR_DIR/bdwgc/libgc.a"
else
  echo "==> bdwgc already built, skipping"
fi

# --- libwebsockets ---
if [ ! -f "$VENDOR_DIR/libwebsockets/build/lib/libwebsockets.a" ]; then
  echo "==> Building libwebsockets..."
  cd "$VENDOR_DIR"
  if [ ! -d libwebsockets ]; then
    git clone --depth 1 https://github.com/warmcat/libwebsockets.git
  fi
  mkdir -p libwebsockets/build && cd libwebsockets/build
  cmake .. \
    -DCMAKE_C_FLAGS="-fPIC" \
    -DLWS_WITH_SSL=OFF \
    -DLWS_WITH_SHARED=OFF \
    -DLWS_WITHOUT_TESTAPPS=ON \
    -DLWS_WITHOUT_TEST_SERVER=ON \
    -DLWS_WITHOUT_TEST_CLIENT=ON \
    -DLWS_WITH_HTTP2=ON \
    -DLWS_WITH_ZLIB=OFF \
    -DLWS_WITH_ZIP_FOPS=OFF \
    -DLWS_WITH_RANGES=OFF \
    -DLWS_WITH_ACCESS_LOG=OFF \
    -DLWS_WITH_DAEMONIZE=OFF
  make -j"$NPROC"
  echo "  -> $VENDOR_DIR/libwebsockets/build/lib/libwebsockets.a"
else
  echo "==> libwebsockets already built, skipping"
fi

# --- lws-bridge ---
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
    -I"$VENDOR_DIR/libwebsockets/include" \
    -I"$VENDOR_DIR/libwebsockets/build" \
    $EXTRA_CFLAGS \
    "$LWS_BRIDGE_SRC" -o "$LWS_BRIDGE_OBJ"
  echo "  -> $LWS_BRIDGE_OBJ"
else
  echo "==> lws-bridge already built, skipping"
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
