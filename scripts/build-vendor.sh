#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENDOR_DIR="$PROJECT_ROOT/vendor"
C_BRIDGES_DIR="$PROJECT_ROOT/c_bridges"
NPROC=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)

# Load pinned versions
source "$SCRIPT_DIR/vendor-pins.sh"

mkdir -p "$VENDOR_DIR"

# --- bdwgc (Boehm GC) ---
if [ ! -f "$VENDOR_DIR/bdwgc/libgc.a" ]; then
  echo "==> Building bdwgc..."
  cd "$VENDOR_DIR"
  if [ ! -d bdwgc ]; then
    git clone --depth 1 --branch "$BDWGC_TAG" https://github.com/ivmai/bdwgc.git
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
    -Denable_cplusplus=OFF -Denable_docs=OFF -Dwithout_libatomic_ops=ON \
    -Denable_threads=ON -Denable_parallel_mark=ON
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
    if [ -n "$PICOHTTPPARSER_COMMIT" ]; then
      git -C picohttpparser-src fetch --depth 1 origin "$PICOHTTPPARSER_COMMIT"
      git -C picohttpparser-src checkout "$PICOHTTPPARSER_COMMIT"
    fi
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
if [ ! -f "$VENDOR_DIR/yyjson/libyyjson.a" ] || [ "$C_BRIDGES_DIR/yyjson-bridge.c" -nt "$VENDOR_DIR/yyjson/libyyjson.a" ]; then
  echo "==> Building yyjson..."
  cd "$VENDOR_DIR"
  if [ ! -d yyjson ]; then
    mkdir -p yyjson
  fi
  if [ ! -f yyjson/yyjson.c ]; then
    git clone --depth 1 --branch "$YYJSON_TAG" https://github.com/ibireme/yyjson.git yyjson-src
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
    git clone --depth 1 --branch "$LIBUV_TAG" https://github.com/libuv/libuv.git
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

# --- multipart-bridge (multipart/form-data parser) ---
MP_BRIDGE_SRC="$C_BRIDGES_DIR/multipart-bridge.c"
MP_BRIDGE_OBJ="$C_BRIDGES_DIR/multipart-bridge.o"
if [ ! -f "$MP_BRIDGE_OBJ" ] || [ "$MP_BRIDGE_SRC" -nt "$MP_BRIDGE_OBJ" ]; then
  echo "==> Building multipart-bridge..."
  cc -c -O2 -fPIC "$MP_BRIDGE_SRC" -o "$MP_BRIDGE_OBJ"
  echo "  -> $MP_BRIDGE_OBJ"
else
  echo "==> multipart-bridge already built, skipping"
fi

# --- librure (Rust regex via the `rure` C ABI) ---
# Static archive built from rust-lang/regex's regex-capi crate. Replaces
# the previous POSIX <regex.h> backend — ~17× faster on real workloads,
# linear-time guarantee (no ReDoS), JS-shaped Unicode semantics by default.
# Build dep: rustup/cargo (only required when (re)building vendor libs;
# end users installing via the release tarball receive a prebuilt librure.a).
RURE_DIR="$VENDOR_DIR/rure"
if [ ! -f "$RURE_DIR/librure.a" ]; then
  echo "==> Building librure (rust-lang/regex@${RUST_REGEX_TAG})..."
  if ! command -v cargo >/dev/null 2>&1; then
    echo "ERROR: cargo not found. Install via https://rustup.rs/ then re-run." >&2
    echo "       (Only contributors building vendor libs need rustc; end" >&2
    echo "        users installing the release tarball do not.)" >&2
    exit 1
  fi
  mkdir -p "$RURE_DIR"
  RURE_SRC="$VENDOR_DIR/rust-regex"
  if [ ! -d "$RURE_SRC" ]; then
    git clone --depth 1 --branch "$RUST_REGEX_TAG" \
      https://github.com/rust-lang/regex.git "$RURE_SRC"
  fi
  (cd "$RURE_SRC/regex-capi" && cargo build --release)
  cp "$RURE_SRC/target/release/librure.a" "$RURE_DIR/librure.a"
  cp "$RURE_SRC/regex-capi/include/rure.h" "$RURE_DIR/rure.h"
  echo "  -> $RURE_DIR/librure.a ($(wc -c < "$RURE_DIR/librure.a") bytes)"
else
  echo "==> librure already built, skipping"
fi

# --- regex-bridge (chad → librure shim) ---
REGEX_BRIDGE_SRC="$C_BRIDGES_DIR/regex-bridge.c"
REGEX_BRIDGE_OBJ="$C_BRIDGES_DIR/regex-bridge.o"
if [ ! -f "$REGEX_BRIDGE_OBJ" ] || [ "$REGEX_BRIDGE_SRC" -nt "$REGEX_BRIDGE_OBJ" ]; then
  echo "==> Building regex-bridge..."
  cc -c -O2 -fPIC "$REGEX_BRIDGE_SRC" -o "$REGEX_BRIDGE_OBJ"
  echo "  -> $REGEX_BRIDGE_OBJ"
else
  echo "==> regex-bridge already built, skipping"
fi

# --- dotenv-bridge (auto-loads .env at startup) ---
DOTENV_BRIDGE_SRC="$C_BRIDGES_DIR/dotenv-bridge.c"
DOTENV_BRIDGE_OBJ="$C_BRIDGES_DIR/dotenv-bridge.o"
if [ ! -f "$DOTENV_BRIDGE_OBJ" ] || [ "$DOTENV_BRIDGE_SRC" -nt "$DOTENV_BRIDGE_OBJ" ]; then
  echo "==> Building dotenv-bridge..."
  cc -c -O2 -fPIC "$DOTENV_BRIDGE_SRC" -o "$DOTENV_BRIDGE_OBJ"
  echo "  -> $DOTENV_BRIDGE_OBJ"
else
  echo "==> dotenv-bridge already built, skipping"
fi

# --- watch-bridge (file watcher for `chad watch`) ---
WATCH_BRIDGE_SRC="$C_BRIDGES_DIR/watch-bridge.c"
WATCH_BRIDGE_OBJ="$C_BRIDGES_DIR/watch-bridge.o"
if [ ! -f "$WATCH_BRIDGE_OBJ" ] || [ "$WATCH_BRIDGE_SRC" -nt "$WATCH_BRIDGE_OBJ" ]; then
  echo "==> Building watch-bridge..."
  cc -c -O2 -fPIC "$WATCH_BRIDGE_SRC" -o "$WATCH_BRIDGE_OBJ"
  echo "  -> $WATCH_BRIDGE_OBJ"
else
  echo "==> watch-bridge already built, skipping"
fi

# --- child-process-bridge (sync only, no libuv dependency) ---
CP_BRIDGE_SRC="$C_BRIDGES_DIR/child-process-bridge.c"
CP_BRIDGE_OBJ="$C_BRIDGES_DIR/child-process-bridge.o"
if [ ! -f "$CP_BRIDGE_OBJ" ] || [ "$CP_BRIDGE_SRC" -nt "$CP_BRIDGE_OBJ" ]; then
  echo "==> Building child-process-bridge..."
  cc -c -O2 -fPIC "$CP_BRIDGE_SRC" -o "$CP_BRIDGE_OBJ"
  echo "  -> $CP_BRIDGE_OBJ"
else
  echo "==> child-process-bridge already built, skipping"
fi

# --- time-bridge (platform-abstracted high-resolution time) ---
TIME_BRIDGE_SRC="$C_BRIDGES_DIR/time-bridge.c"
TIME_BRIDGE_OBJ="$C_BRIDGES_DIR/time-bridge.o"
if [ ! -f "$TIME_BRIDGE_OBJ" ] || [ "$TIME_BRIDGE_SRC" -nt "$TIME_BRIDGE_OBJ" ]; then
  echo "==> Building time-bridge..."
  cc -c -O2 -fPIC "$TIME_BRIDGE_SRC" -o "$TIME_BRIDGE_OBJ"
  echo "  -> $TIME_BRIDGE_OBJ"
else
  echo "==> time-bridge already built, skipping"
fi

# --- string-ops-bridge (optimized toUpperCase, toLowerCase, split, join) ---
STRING_OPS_SRC="$C_BRIDGES_DIR/string-ops-bridge.c"
STRING_OPS_OBJ="$C_BRIDGES_DIR/string-ops-bridge.o"
if [ ! -f "$STRING_OPS_OBJ" ] || [ "$STRING_OPS_SRC" -nt "$STRING_OPS_OBJ" ]; then
  echo "==> Building string-ops-bridge..."
  cc -c -O2 -fPIC "$STRING_OPS_SRC" -o "$STRING_OPS_OBJ"
  echo "  -> $STRING_OPS_OBJ"
else
  echo "==> string-ops-bridge already built, skipping"
fi

# --- os-bridge (platform-abstracted os.freemem/os.uptime) ---
OS_BRIDGE_SRC="$C_BRIDGES_DIR/os-bridge.c"
OS_BRIDGE_OBJ="$C_BRIDGES_DIR/os-bridge.o"
if [ ! -f "$OS_BRIDGE_OBJ" ] || [ "$OS_BRIDGE_SRC" -nt "$OS_BRIDGE_OBJ" ]; then
  echo "==> Building os-bridge..."
  cc -c -O2 -fPIC "$OS_BRIDGE_SRC" -o "$OS_BRIDGE_OBJ"
  echo "  -> $OS_BRIDGE_OBJ"
else
  echo "==> os-bridge already built, skipping"
fi

# --- strlen-cache (cached strlen for charAt optimization) ---
STRLEN_CACHE_SRC="$C_BRIDGES_DIR/strlen-cache.c"
STRLEN_CACHE_OBJ="$C_BRIDGES_DIR/strlen-cache.o"
if [ ! -f "$STRLEN_CACHE_OBJ" ] || [ "$STRLEN_CACHE_SRC" -nt "$STRLEN_CACHE_OBJ" ]; then
  echo "==> Building strlen-cache..."
  cc -c -O2 -fPIC "$STRLEN_CACHE_SRC" -o "$STRLEN_CACHE_OBJ"
  echo "  -> $STRLEN_CACHE_OBJ"
else
  echo "==> strlen-cache already built, skipping"
fi

# --- arena-bridge (bump-pointer arena allocator for strings) ---
ARENA_BRIDGE_SRC="$C_BRIDGES_DIR/arena-bridge.c"
ARENA_BRIDGE_OBJ="$C_BRIDGES_DIR/arena-bridge.o"
if [ ! -f "$ARENA_BRIDGE_OBJ" ] || [ "$ARENA_BRIDGE_SRC" -nt "$ARENA_BRIDGE_OBJ" ]; then
  echo "==> Building arena-bridge..."
  cc -c -O2 -fPIC "$ARENA_BRIDGE_SRC" -o "$ARENA_BRIDGE_OBJ"
  echo "  -> $ARENA_BRIDGE_OBJ"
else
  echo "==> arena-bridge already built, skipping"
fi

# --- curl-bridge (libcurl header parsing helper, needs curl headers) ---
CURL_BRIDGE_SRC="$C_BRIDGES_DIR/curl-bridge.c"
CURL_BRIDGE_OBJ="$C_BRIDGES_DIR/curl-bridge.o"
if [ ! -f "$CURL_BRIDGE_OBJ" ] || [ "$CURL_BRIDGE_SRC" -nt "$CURL_BRIDGE_OBJ" ]; then
  if echo '#include <curl/curl.h>' | cc -xc -fsyntax-only - 2>/dev/null; then
    echo "==> Building curl-bridge..."
    cc -c -O2 -fPIC "$CURL_BRIDGE_SRC" -o "$CURL_BRIDGE_OBJ"
    echo "  -> $CURL_BRIDGE_OBJ"
  else
    echo "==> curl-bridge skipped (no curl headers found)"
  fi
else
  echo "==> curl-bridge already built, skipping"
fi

# --- pg-bridge (libpq Postgres client) ---
PG_BRIDGE_SRC="$C_BRIDGES_DIR/pg-bridge.c"
PG_BRIDGE_OBJ="$C_BRIDGES_DIR/pg-bridge.o"
if [ ! -f "$PG_BRIDGE_OBJ" ] || [ "$PG_BRIDGE_SRC" -nt "$PG_BRIDGE_OBJ" ]; then
  PG_CFLAGS=""
  PG_FOUND=0
  # Prefer pg_config — ships with libpq (libpq-dev on debian/ubuntu, libpq on
  # brew). Knows the right -I regardless of platform-specific install layout.
  if command -v pg_config >/dev/null 2>&1; then
    PG_INCDIR=$(pg_config --includedir 2>/dev/null || echo "")
    if [ -n "$PG_INCDIR" ] && [ -f "$PG_INCDIR/libpq-fe.h" ]; then
      PG_CFLAGS="-I$PG_INCDIR"
      PG_FOUND=1
    fi
  fi
  # Fallback: default cc include path (covers cases where libpq-fe.h is in
  # /usr/include directly or the user has set CPATH/CPLUS_INCLUDE_PATH).
  if [ "$PG_FOUND" = "0" ]; then
    if echo '#include <libpq-fe.h>' | cc -xc -fsyntax-only - 2>/dev/null; then
      PG_FOUND=1
    fi
  fi
  if [ "$PG_FOUND" = "1" ]; then
    echo "==> Building pg-bridge..."
    cc -c -O2 -fPIC $PG_CFLAGS "$PG_BRIDGE_SRC" -o "$PG_BRIDGE_OBJ"
    echo "  -> $PG_BRIDGE_OBJ"
  else
    echo "==> pg-bridge skipped (no libpq headers found — install libpq-dev / libpq)"
  fi
else
  echo "==> pg-bridge already built, skipping"
fi

# --- compress-bridge (zlib + zstd) ---
COMPRESS_BRIDGE_SRC="$C_BRIDGES_DIR/compress-bridge.c"
COMPRESS_BRIDGE_OBJ="$C_BRIDGES_DIR/compress-bridge.o"
if [ ! -f "$COMPRESS_BRIDGE_OBJ" ] || [ "$COMPRESS_BRIDGE_SRC" -nt "$COMPRESS_BRIDGE_OBJ" ]; then
  echo "==> Building compress-bridge..."
  ZSTD_CFLAGS=""
  if [ "$(uname)" = "Darwin" ]; then
    BREW_PREFIX=$(brew --prefix 2>/dev/null || echo "/opt/homebrew")
    ZSTD_PREFIX=$(brew --prefix zstd 2>/dev/null || echo "$BREW_PREFIX")
    if [ -f "$ZSTD_PREFIX/include/zstd.h" ]; then
      ZSTD_CFLAGS="-I$ZSTD_PREFIX/include"
    fi
  fi
  cc -c -O2 -fPIC $ZSTD_CFLAGS "$COMPRESS_BRIDGE_SRC" -o "$COMPRESS_BRIDGE_OBJ"
  echo "  -> $COMPRESS_BRIDGE_OBJ"
else
  echo "==> compress-bridge already built, skipping"
fi

# --- yaml-bridge (pure C, no external deps) ---
YAML_BRIDGE_SRC="$C_BRIDGES_DIR/yaml-bridge.c"
YAML_BRIDGE_OBJ="$C_BRIDGES_DIR/yaml-bridge.o"
if [ ! -f "$YAML_BRIDGE_OBJ" ] || [ "$YAML_BRIDGE_SRC" -nt "$YAML_BRIDGE_OBJ" ]; then
  echo "==> Building yaml-bridge..."
  cc -c -O2 -fPIC "$YAML_BRIDGE_SRC" -o "$YAML_BRIDGE_OBJ"
  echo "  -> $YAML_BRIDGE_OBJ"
else
  echo "==> yaml-bridge already built, skipping"
fi

# --- base64-bridge ---
BASE64_BRIDGE_SRC="$C_BRIDGES_DIR/base64-bridge.c"
BASE64_BRIDGE_OBJ="$C_BRIDGES_DIR/base64-bridge.o"
if [ ! -f "$BASE64_BRIDGE_OBJ" ] || [ "$BASE64_BRIDGE_SRC" -nt "$BASE64_BRIDGE_OBJ" ]; then
  echo "==> Building base64-bridge..."
  cc -c -O2 -fPIC "$BASE64_BRIDGE_SRC" -o "$BASE64_BRIDGE_OBJ"
  echo "  -> $BASE64_BRIDGE_OBJ"
else
  echo "==> base64-bridge already built, skipping"
fi

# --- url-bridge ---
URL_BRIDGE_SRC="$C_BRIDGES_DIR/url-bridge.c"
URL_BRIDGE_OBJ="$C_BRIDGES_DIR/url-bridge.o"
if [ ! -f "$URL_BRIDGE_OBJ" ] || [ "$URL_BRIDGE_SRC" -nt "$URL_BRIDGE_OBJ" ]; then
  echo "==> Building url-bridge..."
  cc -c -O2 -fPIC "$URL_BRIDGE_SRC" -o "$URL_BRIDGE_OBJ"
  echo "  -> $URL_BRIDGE_OBJ"
else
  echo "==> url-bridge already built, skipping"
fi

# --- uri-bridge ---
URI_BRIDGE_SRC="$C_BRIDGES_DIR/uri-bridge.c"
URI_BRIDGE_OBJ="$C_BRIDGES_DIR/uri-bridge.o"
if [ ! -f "$URI_BRIDGE_OBJ" ] || [ "$URI_BRIDGE_SRC" -nt "$URI_BRIDGE_OBJ" ]; then
  echo "==> Building uri-bridge..."
  cc -c -O2 -fPIC "$URI_BRIDGE_SRC" -o "$URI_BRIDGE_OBJ"
  echo "  -> $URI_BRIDGE_OBJ"
else
  echo "==> uri-bridge already built, skipping"
fi
# --- llvm-bridge (requires LLVM dev libraries) ---
LLVM_BRIDGE_SRC="$C_BRIDGES_DIR/llvm-bridge.c"
LLVM_BRIDGE_OBJ="$C_BRIDGES_DIR/llvm-bridge.o"
LLVM_CONFIG=""
if command -v llvm-config >/dev/null 2>&1; then
  LLVM_CONFIG="llvm-config"
elif [ -f "/opt/homebrew/opt/llvm/bin/llvm-config" ]; then
  LLVM_CONFIG="/opt/homebrew/opt/llvm/bin/llvm-config"
elif [ -f "/usr/local/opt/llvm/bin/llvm-config" ]; then
  LLVM_CONFIG="/usr/local/opt/llvm/bin/llvm-config"
elif [ -f "/usr/lib/llvm-21/bin/llvm-config" ]; then
  LLVM_CONFIG="/usr/lib/llvm-21/bin/llvm-config"
elif [ -f "/usr/lib/llvm-18/bin/llvm-config" ]; then
  LLVM_CONFIG="/usr/lib/llvm-18/bin/llvm-config"
fi
if [ -n "$LLVM_CONFIG" ]; then
  if [ ! -f "$LLVM_BRIDGE_OBJ" ] || [ "$LLVM_BRIDGE_SRC" -nt "$LLVM_BRIDGE_OBJ" ]; then
    echo "==> Building llvm-bridge (using $LLVM_CONFIG)..."
    LLVM_CFLAGS=$($LLVM_CONFIG --cflags)
    LLVM_BINDIR=$(dirname "$LLVM_CONFIG")
    LLVM_CC="$LLVM_BINDIR/clang"
    if [ ! -f "$LLVM_CC" ]; then
      LLVM_CC="cc"
    fi
    $LLVM_CC -c -O2 -fPIC $LLVM_CFLAGS "$LLVM_BRIDGE_SRC" -o "$LLVM_BRIDGE_OBJ"
    echo "  -> $LLVM_BRIDGE_OBJ"
  else
    echo "==> llvm-bridge already built, skipping"
  fi
  LLVM_BUILDER_SRC="$C_BRIDGES_DIR/llvm-builder-bridge.c"
  LLVM_BUILDER_OBJ="$C_BRIDGES_DIR/llvm-builder-bridge.o"
  if [ ! -f "$LLVM_BUILDER_OBJ" ] || [ "$LLVM_BUILDER_SRC" -nt "$LLVM_BUILDER_OBJ" ]; then
    echo "==> Building llvm-builder-bridge..."
    $LLVM_CC -c -O2 -fPIC $LLVM_CFLAGS "$LLVM_BUILDER_SRC" -o "$LLVM_BUILDER_OBJ"
    echo "  -> $LLVM_BUILDER_OBJ"
  else
    echo "==> llvm-builder-bridge already built, skipping"
  fi
else
  echo "==> llvm-bridge skipped (no llvm-config found)"
fi

# --- lld-bridge (macOS only — requires LLD dynamic libs; Linux uses stub) ---
LLD_BRIDGE_SRC="$C_BRIDGES_DIR/lld-bridge.cpp"
LLD_BRIDGE_OBJ="$C_BRIDGES_DIR/lld-bridge.o"
LLD_STUB_SRC="$C_BRIDGES_DIR/lld-stub.c"
if [ "$(uname)" = "Darwin" ]; then
  LLD_INCLUDE=""
  if [ -d "/opt/homebrew/opt/lld/include" ]; then
    LLD_INCLUDE="/opt/homebrew/opt/lld/include"
  elif [ -d "/usr/local/opt/lld/include" ]; then
    LLD_INCLUDE="/usr/local/opt/lld/include"
  fi
  if [ -n "$LLVM_CONFIG" ] && [ -n "$LLD_INCLUDE" ]; then
    if [ ! -f "$LLD_BRIDGE_OBJ" ] || [ "$LLD_BRIDGE_SRC" -nt "$LLD_BRIDGE_OBJ" ]; then
      echo "==> Building lld-bridge (using $LLVM_CONFIG)..."
      LLVM_CXXFLAGS=$($LLVM_CONFIG --cxxflags | sed 's/-fno-exceptions//g')
      LLVM_BINDIR=$(dirname "$LLVM_CONFIG")
      LLVM_CXX="$LLVM_BINDIR/clang++"
      if [ ! -f "$LLVM_CXX" ]; then
        LLVM_CXX="c++"
      fi
      $LLVM_CXX -c -O2 -fPIC $LLVM_CXXFLAGS -I"$LLD_INCLUDE" "$LLD_BRIDGE_SRC" -o "$LLD_BRIDGE_OBJ"
      echo "  -> $LLD_BRIDGE_OBJ"
    else
      echo "==> lld-bridge already built, skipping"
    fi
  else
    if [ ! -f "$LLD_BRIDGE_OBJ" ] || [ "$LLD_STUB_SRC" -nt "$LLD_BRIDGE_OBJ" ]; then
      echo "==> Building lld-stub (no lld headers found)..."
      cc -c -O2 -fPIC "$LLD_STUB_SRC" -o "$LLD_BRIDGE_OBJ"
      echo "  -> $LLD_BRIDGE_OBJ (stub)"
    else
      echo "==> lld-bridge already built, skipping"
    fi
  fi
else
  if [ ! -f "$LLD_BRIDGE_OBJ" ] || [ "$LLD_STUB_SRC" -nt "$LLD_BRIDGE_OBJ" ]; then
    echo "==> Building lld-stub (Linux uses clang for linking)..."
    cc -c -O2 -fPIC "$LLD_STUB_SRC" -o "$LLD_BRIDGE_OBJ"
    echo "  -> $LLD_BRIDGE_OBJ (stub)"
  else
    echo "==> lld-bridge already built, skipping"
  fi
fi

# --- child-process-spawn (async, requires libuv) ---
CP_SPAWN_SRC="$C_BRIDGES_DIR/child-process-spawn.c"
CP_SPAWN_OBJ="$C_BRIDGES_DIR/child-process-spawn.o"
if [ ! -f "$CP_SPAWN_OBJ" ] || [ "$CP_SPAWN_SRC" -nt "$CP_SPAWN_OBJ" ]; then
  echo "==> Building child-process-spawn..."
  cc -c -O2 -fPIC -I"$VENDOR_DIR/libuv/include" "$CP_SPAWN_SRC" -o "$CP_SPAWN_OBJ"
  echo "  -> $CP_SPAWN_OBJ"
else
  echo "==> child-process-spawn already built, skipping"
fi

# --- net-bridge (TCP client sockets via libuv) ---
NET_BRIDGE_SRC="$C_BRIDGES_DIR/net-bridge.c"
NET_BRIDGE_OBJ="$C_BRIDGES_DIR/net-bridge.o"
if [ ! -f "$NET_BRIDGE_OBJ" ] || [ "$NET_BRIDGE_SRC" -nt "$NET_BRIDGE_OBJ" ]; then
  echo "==> Building net-bridge..."
  # OpenSSL headers: brew on mac, system on linux (libssl-dev provides /usr/include/openssl).
  OSSL_INC=""
  if [ -d "/opt/homebrew/opt/openssl/include" ]; then
    OSSL_INC="-I/opt/homebrew/opt/openssl/include"
  elif [ -d "/usr/local/opt/openssl/include" ]; then
    OSSL_INC="-I/usr/local/opt/openssl/include"
  fi
  cc -c -O2 -fPIC -I"$VENDOR_DIR/libuv/include" $OSSL_INC "$NET_BRIDGE_SRC" -o "$NET_BRIDGE_OBJ"
  echo "  -> $NET_BRIDGE_OBJ"
else
  echo "==> net-bridge already built, skipping"
fi

# --- trampoline-bridge (C-ABI closure slot table) ---
TRAMP_SRC="$C_BRIDGES_DIR/trampoline-bridge.c"
TRAMP_OBJ="$C_BRIDGES_DIR/trampoline-bridge.o"
TRAMP_HDR="$C_BRIDGES_DIR/trampoline-bridge.h"
if [ ! -f "$TRAMP_OBJ" ] || [ "$TRAMP_SRC" -nt "$TRAMP_OBJ" ] || [ "$TRAMP_HDR" -nt "$TRAMP_OBJ" ]; then
  echo "==> Building trampoline-bridge..."
  cc -c -O2 -fPIC "$TRAMP_SRC" -o "$TRAMP_OBJ"
  echo "  -> $TRAMP_OBJ"
else
  echo "==> trampoline-bridge already built, skipping"
fi

# --- tree-sitter ---
if [ ! -f "$VENDOR_DIR/tree-sitter/libtree-sitter.a" ]; then
  echo "==> Building tree-sitter..."
  cd "$VENDOR_DIR"
  if [ ! -d tree-sitter ]; then
    git clone --depth 1 --branch "$TREE_SITTER_TAG" https://github.com/tree-sitter/tree-sitter.git
  fi
  cd tree-sitter
  make -j"$NPROC"
  echo "  -> $VENDOR_DIR/tree-sitter/libtree-sitter.a"
else
  echo "==> tree-sitter already built, skipping"
fi

echo ""
echo "All vendor libraries built successfully in $VENDOR_DIR"
