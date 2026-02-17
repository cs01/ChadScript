# Installation

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/cs01/ChadScript/main/install.sh | sh
```

This downloads a pre-built binary for your platform and installs it to `~/.chadscript/`.

## Prerequisites

ChadScript compiles your TypeScript to native code via LLVM. **LLVM is the only required dependency** — everything else is bundled in the release:

- **macOS**: `brew install llvm`
- **Ubuntu/Debian**: `sudo apt install llvm clang`
- **Fedora**: `sudo dnf install llvm clang`

If your program uses certain features, you'll also need the corresponding system library installed on the machine where you compile:

| Feature | Package |
|---------|---------|
| `fetch()` / HTTP client | libcurl |
| `crypto` | openssl |
| `sqlite` | sqlite3 |

Most programs don't need any of these.

**macOS Gatekeeper**: If you get a quarantine warning on the downloaded binary:

```bash
xattr -d com.apple.quarantine ~/.chadscript/chad
```

## Your First Program

Create a file `hello.ts`:

```typescript
console.log("Hello from ChadScript!");
```

Run it directly:

```bash
chad run hello.ts
```

Or compile to a standalone binary:

```bash
chad build hello.ts -o hello
./hello
```

## Build from Source

See [BUILDING.md](https://github.com/cs01/ChadScript/blob/main/BUILDING.md) for full instructions.

```bash
git clone https://github.com/cs01/ChadScript && cd ChadScript
npm install
bash scripts/build-vendor.sh
npm run build
npm test
```

## Next Steps

- Browse the [Standard Library](/stdlib/) for all available APIs
- See [CLI Reference](/getting-started/cli) for all compiler options
- Check [Benchmarks](/benchmarks) to see how ChadScript performs
