# Building ChadScript v2 from Source

## Prerequisites

```bash
# macOS
brew install llvm node

# Ubuntu/Debian
sudo apt-get install llvm clang nodejs npm
```

## Build & Test

```bash
npm install
npm test
```

## Usage

```bash
npx tsx src/cli.ts build hello.ts -o hello
./hello
```
