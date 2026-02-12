# Installation

## Download a Release

Download the latest release from [GitHub Releases](https://github.com/cs01/ChadScript/releases), extract it, and add it to your PATH.

## System Dependencies

ChadScript compiles to native code via LLVM and links against several system libraries. You'll need:

### Ubuntu / Debian

```bash
sudo apt-get install llvm clang libcurl4-openssl-dev libssl-dev libsqlite3-dev
```

### RHEL / Fedora

```bash
sudo dnf install llvm clang libcurl-devel openssl-devel sqlite-devel
```

### macOS

```bash
brew install llvm openssl sqlite
export PATH="/opt/homebrew/opt/llvm/bin:$PATH"
```

## Build from Source

See [BUILDING.md](https://github.com/cs01/ChadScript/blob/main/BUILDING.md) for full instructions.

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
