# Building ChadScript from Source

## Prerequisites

**Runtime dependencies** (needed even if using a release binary):

```bash
# Ubuntu/Debian
sudo apt-get install llvm clang libcurl4-openssl-dev

# RHEL/Fedora
sudo dnf install llvm clang libcurl-devel

# macOS
brew install llvm
export PATH="/opt/homebrew/opt/llvm/bin:$PATH"
```

**Build dependencies** (only needed when building from source):

```bash
# Ubuntu/Debian
sudo apt-get install cmake autoconf automake libtool nodejs npm

# RHEL/Fedora
sudo dnf install cmake autoconf automake libtool nodejs npm

# macOS
brew install cmake autoconf automake libtool node
```

## Build

```bash
git clone https://github.com/cs01/ChadScript && cd ChadScript
npm install
bash scripts/build-vendor.sh
npm run build
```

`scripts/build-vendor.sh` clones and builds static archives for libgc, cJSON, libuv, tree-sitter, and mongoose into `vendor/`. It's idempotent — re-running skips already-built libraries.

## Verify

```bash
npm test
chad build examples/hello.ts -o /tmp/hello
/tmp/hello
```

## Environment Variables

Override vendor library paths if you have your own builds:

```bash
export CHADSCRIPT_BDWGC_PATH=/path/to/bdwgc
export CHADSCRIPT_MONGOOSE_PATH=/path/to/mongoose
export CHADSCRIPT_CJSON_PATH=/path/to/cjson/build
export CHADSCRIPT_LIBUV_PATH=/path/to/libuv/build
export CHADSCRIPT_TREESITTER_PATH=/path/to/tree-sitter
```

## Self-Hosting (Stage 0)

ChadScript can compile its own compiler to a native binary:

```bash
chadc --link-tree-sitter --skip-semantic-analysis src/native-compiler.ts -o /tmp/chad-stage0

/tmp/chad-stage0 src/native-compiler.ts -o /tmp/chad-stage1
```

The Stage 1 binary is a standalone native compiler that needs no Node.js runtime.
