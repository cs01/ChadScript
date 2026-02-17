#!/bin/sh
set -e

REPO="cs01/ChadScript"
INSTALL_DIR="$HOME/.chadscript"

detect_libc() {
  if [ "$(uname -s)" != "Linux" ]; then
    echo ""
    return
  fi
  if ls /lib/ld-musl-* >/dev/null 2>&1; then
    echo "musl"
  elif ldd --version 2>&1 | grep -qi musl; then
    echo "musl"
  else
    echo "glibc"
  fi
}

main() {
  OS=$(uname -s)
  ARCH=$(uname -m)

  case "$OS" in
    Linux)  OS_TAG="linux" ;;
    Darwin) OS_TAG="macos" ;;
    *)
      echo "Unsupported OS: $OS"
      exit 1
      ;;
  esac

  case "$ARCH" in
    x86_64|amd64)  ARCH_TAG="x64" ;;
    arm64|aarch64) ARCH_TAG="arm64" ;;
    *)
      echo "Unsupported architecture: $ARCH"
      exit 1
      ;;
  esac

  LIBC=$(detect_libc)
  if [ "$LIBC" = "musl" ]; then
    TARBALL="chadscript-linux-musl-${ARCH_TAG}.tar.gz"
  else
    TARBALL="chadscript-${OS_TAG}-${ARCH_TAG}.tar.gz"
  fi
  URL="${CHADSCRIPT_URL:-https://github.com/${REPO}/releases/download/latest/${TARBALL}}"

  echo "Downloading ChadScript (${OS_TAG}-${ARCH_TAG}${LIBC:+, $LIBC})..."
  echo "  $URL"

  TMPDIR=$(mktemp -d)
  trap 'rm -rf "$TMPDIR"' EXIT

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$URL" -o "$TMPDIR/$TARBALL"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$URL" -O "$TMPDIR/$TARBALL"
  else
    echo "Error: curl or wget is required"
    exit 1
  fi

  echo "Installing to $INSTALL_DIR..."
  mkdir -p "$INSTALL_DIR"
  tar -xzf "$TMPDIR/$TARBALL" -C "$INSTALL_DIR"

  if [ "$OS_TAG" = "macos" ]; then
    xattr -d com.apple.quarantine "$INSTALL_DIR/chad" 2>/dev/null || true
    xattr -d com.apple.quarantine "$INSTALL_DIR/chadc" 2>/dev/null || true
  fi

  add_to_path

  echo ""
  echo "ChadScript installed to $INSTALL_DIR"
  echo ""
  echo "Prerequisites — install LLVM if you haven't already:"
  case "$OS_TAG" in
    macos) echo "  brew install llvm" ;;
    linux) echo "  sudo apt install llvm clang   # Debian/Ubuntu"
           echo "  sudo dnf install llvm clang   # Fedora" ;;
  esac
  echo ""
  echo "Restart your shell or run:"
  echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
  echo ""
  echo "Then try:"
  echo "  chad run examples/hello.ts"
}

add_to_path() {
  EXPORT_LINE="export PATH=\"$INSTALL_DIR:\$PATH\""

  for RC_FILE in "$HOME/.bashrc" "$HOME/.zshrc"; do
    if [ -f "$RC_FILE" ]; then
      if ! grep -qF "$INSTALL_DIR" "$RC_FILE" 2>/dev/null; then
        echo "" >> "$RC_FILE"
        echo "# ChadScript" >> "$RC_FILE"
        echo "$EXPORT_LINE" >> "$RC_FILE"
        echo "  Added to PATH in $(basename "$RC_FILE")"
      fi
    fi
  done

  if [ ! -f "$HOME/.bashrc" ] && [ ! -f "$HOME/.zshrc" ]; then
    echo "  Add this to your shell rc file:"
    echo "    $EXPORT_LINE"
  fi
}

main
