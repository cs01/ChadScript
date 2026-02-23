#!/bin/sh
set -e

REPO="cs01/ChadScript"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.chadscript}"
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

prompt_yn() {
  _prompt="$1"
  _default="$2"

  if [ -n "$SKIP_PROMPTS" ]; then
    [ "$_default" = "y" ] && return 0 || return 1
  fi

  if ! [ -t 0 ] && ! [ -e /dev/tty ]; then
    [ "$_default" = "y" ] && return 0 || return 1
  fi

  if [ "$_default" = "y" ]; then
    _suffix="[Y/n]"
  else
    _suffix="[y/N]"
  fi

  while true; do
    if [ -t 0 ]; then
      printf "  %s %s " "$_prompt" "$_suffix"
      read _response
    else
      printf "  %s %s " "$_prompt" "$_suffix" > /dev/tty
      read _response < /dev/tty
    fi
    _response=${_response:-$_default}
    case "$_response" in
      [Yy]|[Yy][Ee][Ss]) return 0 ;;
      [Nn]|[Nn][Oo]) return 1 ;;
      *) printf "  Please answer yes or no.\n" ;;
    esac
  done
}

check_llvm() {
  command -v llc >/dev/null 2>&1 || [ -x /opt/homebrew/opt/llvm/bin/llc ] || [ -x /usr/local/opt/llvm/bin/llc ]
}

show_llvm_install_help() {
  printf "\n"
  printf "  ${YELLOW}${BOLD}LLVM is required${RESET} — ChadScript needs ${BOLD}llc${RESET} and ${BOLD}clang${RESET} to compile.\n"
  printf "\n"
  case "$1" in
    macos)
      printf "    ${BOLD}brew install llvm${RESET}\n"
      ;;
    linux)
      printf "    ${BOLD}sudo apt install llvm clang${RESET}   ${DIM}# Debian/Ubuntu${RESET}\n"
      printf "    ${BOLD}sudo dnf install llvm clang${RESET}   ${DIM}# Fedora${RESET}\n"
      printf "    ${BOLD}sudo pacman -S llvm clang${RESET}     ${DIM}# Arch${RESET}\n"
      ;;
  esac
  printf "\n"
  printf "  After installing LLVM, run this installer again.\n"
}

verify_install() {
  VERIFY_DIR=$(mktemp -d)
  trap 'rm -rf "$VERIFY_DIR"' RETURN 2>/dev/null || true

  cat > "$VERIFY_DIR/hello.ts" << 'HELLO'
console.log("hello from chad");
HELLO

  OUTPUT=$("$INSTALL_DIR/chad" run "$VERIFY_DIR/hello.ts" 2>&1) || {
    rm -rf "$VERIFY_DIR"
    return 1
  }
  rm -rf "$VERIFY_DIR"
  [ "$OUTPUT" = "hello from chad" ]
}

detect_shell_profile() {
  case "$SHELL" in
    */zsh)  echo "$HOME/.zshrc" ;;
    */bash)
      if [ -f "$HOME/.bashrc" ]; then echo "$HOME/.bashrc"
      elif [ -f "$HOME/.bash_profile" ]; then echo "$HOME/.bash_profile"
      else echo "$HOME/.profile"
      fi ;;
    *)
      if [ -f "$HOME/.zshrc" ]; then echo "$HOME/.zshrc"
      elif [ -f "$HOME/.bashrc" ]; then echo "$HOME/.bashrc"
      elif [ -f "$HOME/.bash_profile" ]; then echo "$HOME/.bash_profile"
      else echo "$HOME/.profile"
      fi ;;
  esac
}

add_to_path() {
  EXPORT_LINE="export PATH=\"$INSTALL_DIR:\$PATH\""
  SHELL_PROFILE=$(detect_shell_profile)

  if grep -qF "$INSTALL_DIR" "$SHELL_PROFILE" 2>/dev/null; then
    success "PATH already configured in $(basename "$SHELL_PROFILE")"
    return
  fi

  if prompt_yn "Add ChadScript to PATH in $(basename "$SHELL_PROFILE")?" "y"; then
    echo "" >> "$SHELL_PROFILE"
    echo "# ChadScript" >> "$SHELL_PROFILE"
    echo "$EXPORT_LINE" >> "$SHELL_PROFILE"
    success "Added to PATH in $(basename "$SHELL_PROFILE")"
  else
    printf "\n"
    warn "Skipped PATH configuration. Add this to your shell config manually:"
    printf "    %s\n" "$EXPORT_LINE"
  fi
}

main() {
  printf "\n"
  printf "  ${BOLD}ChadScript Installer${RESET} ${DIM}v${VERSION}${RESET}\n"
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

  TARBALL="chadscript-${OS_TAG}-${ARCH_TAG}.tar.gz"
  URL="${CHADSCRIPT_URL:-https://github.com/${REPO}/releases/download/latest/${TARBALL}}"

  PLATFORM="${OS_TAG}-${ARCH_TAG}"
  info "Platform: ${BOLD}${PLATFORM}${RESET}"
  info "Install directory: ${BOLD}${INSTALL_DIR}${RESET}"
  printf "\n"

  if ! prompt_yn "Proceed with installation?" "y"; then
    printf "\n"
    info "Installation cancelled."
    exit 0
  fi
  printf "\n"

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

  cat > "$INSTALL_DIR/chad" << 'WRAPPER'
#!/bin/sh
DIR=$(cd "$(dirname "$(command -v "$0")")" && pwd)
exec "$DIR/chad.bin" "$@"
WRAPPER
  chmod +x "$INSTALL_DIR/chad"

  if [ "$OS_TAG" = "macos" ]; then
    xattr -d com.apple.quarantine "$INSTALL_DIR/chad.bin" 2>/dev/null || true
  fi

  success "Installed chad"
  printf "\n"

  add_to_path

  # Make chad available in the current shell immediately
  export PATH="$INSTALL_DIR:$PATH"

  printf "\n"
  printf "  ${GREEN}${BOLD}ChadScript installed successfully!${RESET}\n"
  printf "\n"

  if prompt_yn "Verify installation now? (compiles a hello world)" "y"; then
    printf "\n"
    if ! check_llvm; then
      show_llvm_install_help "$OS_TAG"
    else
      info "Running: chad run hello.ts"
      if verify_install; then
        success "Verified — compiled and ran successfully"
      else
        printf "\n"
        warn "Smoke test failed."
        printf "  chad was installed but could not compile a hello world program.\n"
        printf "\n"
        printf "  Try running manually:\n"
        printf "    ${CYAN}$INSTALL_DIR/chad run hello.ts${RESET}\n"
        printf "\n"
      fi
    fi
  fi

  printf "\n"
  printf "  ${BOLD}chad${RESET} is ready to use in this shell.\n"
  printf "\n"
  printf "  Get started:\n"
  printf "\n"
  printf "    ${CYAN}mkdir myproject && cd myproject${RESET}\n"
  printf "    ${CYAN}chad init${RESET}\n"
  printf "    ${CYAN}chad run hello.ts${RESET}\n"
  printf "\n"
}

main
