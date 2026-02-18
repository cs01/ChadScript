#!/bin/sh
set -e

REPO="cs01/ChadScript"
INSTALL_DIR="$HOME/.chadscript"
VERSION="0.1.0"

if [ -t 1 ]; then
  ESC=$(printf '\033')
  BOLD="${ESC}[1m"
  DIM="${ESC}[2m"
  GREEN="${ESC}[32m"
  CYAN="${ESC}[36m"
  YELLOW="${ESC}[33m"
  RED="${ESC}[31m"
  RESET="${ESC}[0m"
else
  BOLD='' DIM='' GREEN='' CYAN='' YELLOW='' RED='' RESET=''
fi

info()    { printf "%s\n" "${CYAN}info${RESET} $1"; }
success() { printf "%s\n" "${GREEN}  ✓${RESET} $1"; }
warn()    { printf "%s\n" "${YELLOW}warn${RESET} $1"; }
err()     { printf "%s\n" "${RED}error${RESET} $1" >&2; exit 1; }

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
  printf "\n"
  printf "${BOLD}  ChadScript Installer${RESET} ${DIM}v${VERSION}${RESET}\n"
  printf "\n"

  OS=$(uname -s)
  ARCH=$(uname -m)

  case "$OS" in
    Linux)  OS_TAG="linux" ;;
    Darwin) OS_TAG="macos" ;;
    *)      err "Unsupported OS: $OS" ;;
  esac

  case "$ARCH" in
    x86_64|amd64)  ARCH_TAG="x64" ;;
    arm64|aarch64) ARCH_TAG="arm64" ;;
    *)             err "Unsupported architecture: $ARCH" ;;
  esac

  LIBC=$(detect_libc)
  if [ "$LIBC" = "musl" ]; then
    TARBALL="chadscript-linux-musl-${ARCH_TAG}.tar.gz"
  else
    TARBALL="chadscript-${OS_TAG}-${ARCH_TAG}.tar.gz"
  fi
  URL="${CHADSCRIPT_URL:-https://github.com/${REPO}/releases/download/latest/${TARBALL}}"

  PLATFORM="${OS_TAG}-${ARCH_TAG}${LIBC:+ ($LIBC)}"
  info "Platform: ${BOLD}${PLATFORM}${RESET}"

  info "Downloading ${DIM}${URL}${RESET}"
  TMPDIR=$(mktemp -d)
  trap 'rm -rf "$TMPDIR"' EXIT

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$URL" -o "$TMPDIR/$TARBALL"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$URL" -O "$TMPDIR/$TARBALL"
  else
    err "curl or wget is required"
  fi
  success "Downloaded"

  info "Installing to ${BOLD}${INSTALL_DIR}${RESET}"
  mkdir -p "$INSTALL_DIR"
  tar -xzf "$TMPDIR/$TARBALL" -C "$INSTALL_DIR"

  mv "$INSTALL_DIR/chad" "$INSTALL_DIR/chad.bin"
  mv "$INSTALL_DIR/chadc" "$INSTALL_DIR/chadc.bin"

  cat > "$INSTALL_DIR/chad" << 'WRAPPER'
#!/bin/sh
DIR=$(cd "$(dirname "$(command -v "$0")")" && pwd)
exec "$DIR/chad.bin" "$@"
WRAPPER
  chmod +x "$INSTALL_DIR/chad"

  cat > "$INSTALL_DIR/chadc" << 'WRAPPER'
#!/bin/sh
DIR=$(cd "$(dirname "$(command -v "$0")")" && pwd)
exec "$DIR/chadc.bin" "$@"
WRAPPER
  chmod +x "$INSTALL_DIR/chadc"

  if [ "$OS_TAG" = "macos" ]; then
    xattr -d com.apple.quarantine "$INSTALL_DIR/chad.bin" 2>/dev/null || true
    xattr -d com.apple.quarantine "$INSTALL_DIR/chadc.bin" 2>/dev/null || true
  fi

  success "Installed chad and chadc"

  add_to_path

  printf "\n"
  printf "${GREEN}${BOLD}  ChadScript installed successfully!${RESET}\n"
  printf "\n"

  if ! check_llvm; then
    printf "  ${YELLOW}${BOLD}Prerequisites${RESET} — LLVM is required to compile:\n"
    printf "\n"
    case "$OS_TAG" in
      macos)
        printf "    ${BOLD}brew install llvm${RESET}\n"
        ;;
      linux)
        printf "    ${BOLD}sudo apt install llvm clang${RESET}   ${DIM}# Debian/Ubuntu${RESET}\n"
        printf "    ${BOLD}sudo dnf install llvm clang${RESET}   ${DIM}# Fedora${RESET}\n"
        ;;
    esac
    printf "\n"
  fi

  printf "  Restart your shell, or run:\n"
  printf "\n"
  printf "    ${CYAN}export PATH=\"$INSTALL_DIR:\$PATH\"${RESET}\n"
  printf "\n"
  printf "  Then try:\n"
  printf "\n"
  printf "    ${CYAN}mkdir myproject && cd myproject${RESET}\n"
  printf "    ${CYAN}chad init${RESET}\n"
  printf "    ${CYAN}chad run hello.ts${RESET}\n"
  printf "\n"
}

check_llvm() {
  command -v llc >/dev/null 2>&1 && return 0
  [ -x /opt/homebrew/opt/llvm/bin/llc ] && return 0
  [ -x /usr/local/opt/llvm/bin/llc ] && return 0
  return 1
}

add_to_path() {
  EXPORT_LINE="export PATH=\"$INSTALL_DIR:\$PATH\""

  for RC_FILE in "$HOME/.bashrc" "$HOME/.zshrc"; do
    if [ -f "$RC_FILE" ]; then
      if ! grep -qF "$INSTALL_DIR" "$RC_FILE" 2>/dev/null; then
        echo "" >> "$RC_FILE"
        echo "# ChadScript" >> "$RC_FILE"
        echo "$EXPORT_LINE" >> "$RC_FILE"
        success "Added to PATH in $(basename "$RC_FILE")"
      fi
    fi
  done

  if [ ! -f "$HOME/.bashrc" ] && [ ! -f "$HOME/.zshrc" ]; then
    warn "Add this to your shell config:"
    printf "    %s\n" "$EXPORT_LINE"
  fi
}

main
