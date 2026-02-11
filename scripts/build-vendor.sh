#!/usr/bin/env bash
set -euo pipefail

VENDOR_DIR="$(cd "$(dirname "$0")/.." && pwd)/vendor"
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
  echo "  -> $VENDOR_DIR/bdwgc/libgc.a"
else
  echo "==> bdwgc already built, skipping"
fi

# --- mongoose ---
if [ ! -f "$VENDOR_DIR/mongoose/mongoose.o" ]; then
  echo "==> Building mongoose..."
  cd "$VENDOR_DIR"
  if [ ! -d mongoose ]; then
    git clone --depth 1 https://github.com/cesanta/mongoose.git
  fi
  cd mongoose
  cc -c -O2 -DMG_ENABLE_IPV6=0 mongoose.c -o mongoose.o
  echo "  -> $VENDOR_DIR/mongoose/mongoose.o"
else
  echo "==> mongoose already built, skipping"
fi

# --- cJSON ---
if [ ! -f "$VENDOR_DIR/cJSON/build/libcjson.a" ]; then
  echo "==> Building cJSON..."
  cd "$VENDOR_DIR"
  if [ ! -d cJSON ]; then
    git clone --depth 1 https://github.com/DaveGamble/cJSON.git
  fi
  mkdir -p cJSON/build
  cd cJSON/build
  cmake .. \
    -DCMAKE_C_FLAGS="-fPIC" \
    -DENABLE_CJSON_TEST=OFF \
    -DBUILD_SHARED_LIBS=OFF \
    -DBUILD_SHARED_AND_STATIC_LIBS=OFF
  make -j"$NPROC"
  echo "  -> $VENDOR_DIR/cJSON/build/libcjson.a"
else
  echo "==> cJSON already built, skipping"
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
