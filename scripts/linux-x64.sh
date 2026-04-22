#!/usr/bin/env bash
# Run CI-equivalent Linux x86-64 build/self-hosting locally on arm64 macOS via podman.
# Useful for catching arch-specific regressions before pushing to CI.
#
# Usage:
#   bash scripts/linux-x64.sh build     # build the image (one-time)
#   bash scripts/linux-x64.sh shell     # interactive shell in the container
#   bash scripts/linux-x64.sh verify    # run full verify inside x86-64 container
#
# The container mounts the current worktree at /ws, so edits made on the host
# are visible inside. vendor/ and node_modules/ are built INSIDE the container
# (x86-64 binaries), so don't share them with the host.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="chad-linux-x64"

cmd="${1:-shell}"

case "$cmd" in
  build)
    podman build --platform=linux/amd64 -t "$IMAGE" -f "$ROOT/scripts/linux-x64.Dockerfile" "$ROOT/scripts"
    ;;
  shell)
    podman run --rm -it --platform=linux/amd64 \
      -v "$ROOT:/ws:Z" -w /ws "$IMAGE" bash
    ;;
  verify)
    podman run --rm --platform=linux/amd64 \
      -v "$ROOT:/ws:Z" -w /ws "$IMAGE" bash -c '
        set -e
        rm -rf node_modules vendor dist .build build
        npm install --ignore-scripts
        bash scripts/build-vendor.sh
        npm run build
        # Rosetta reports an unrecognized CPU name to clang, so pin to x86-64 baseline.
        node dist/chad-node.js build src/chad-native.ts -o /tmp/chad-stage0 --target-cpu=x86-64
        echo "--- stage 0 built, running stage 0 → stage 1 ---"
        /tmp/chad-stage0 build src/chad-native.ts -o /tmp/chad-stage1 --target-cpu=x86-64
      '
    ;;
  *)
    echo "usage: $0 build|shell|verify" >&2
    exit 1
    ;;
esac
