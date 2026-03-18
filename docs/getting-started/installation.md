# Installation

```bash
curl -fsSL https://raw.githubusercontent.com/cs01/ChadScript/main/install.sh | sh
```

This downloads a pre-built binary for your platform and installs it to `~/.chadscript/`.

## Prerequisites

None. Everything is bundled in the compiler — just install and go.

On some Linux systems, programs that use networking or crypto may need common system libraries (libcurl, openssl) which are typically pre-installed. macOS includes them by default.

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
