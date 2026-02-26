# Get Started

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/cs01/ChadScript/main/install.sh | sh
```

This downloads a pre-built binary for your platform and installs it to `~/.chadscript/`.

## Prerequisites

ChadScript compiles your TypeScript to native code via LLVM. The release bundles all vendor libraries (libgc, libuv, etc.) and pre-compiled C bridge objects, so **LLVM is the only required base dependency**:

- **macOS**: `brew install llvm`
- **Ubuntu/Debian**: `sudo apt install llvm clang`
- **Fedora**: `sudo dnf install llvm clang`

Programs that use certain features also need the corresponding system library present at compile time:

| Feature | Package |
|---------|---------|
| `fetch()` / HTTP client | libcurl |
| `crypto` | openssl |
| `sqlite` | sqlite3 |
| `httpServe()` | zlib, libzstd |

**macOS Gatekeeper**: If you get a quarantine warning on the downloaded binary:

```bash
xattr -d com.apple.quarantine ~/.chadscript/chad
```

## Build from Source

```bash
git clone https://github.com/cs01/ChadScript && cd ChadScript
npm install
bash scripts/build-vendor.sh
npm run build
```

This produces `dist/chad-node.js`. Use it directly:

```bash
node dist/chad-node.js build hello.ts -o hello
```

See [BUILDING.md](https://github.com/cs01/ChadScript/blob/main/BUILDING.md) for full instructions including native compiler setup and cross-compilation.
