#!/bin/sh
# One-command prerequisite check for building programs (the docs quickstart runs it). Required:
# bun (runs the compiler), clang + opt (CHAD_CLANG / CHAD_OPT override the names), and the pinned
# Milo compiler in .milo/ (or CHAD_MILO). Optional: node (the semantics oracle for the tests) and
# rustc (benchmarks). Exits 1 if anything required is missing.
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
missing=0

check() { # label, command, required(1/0), hint
  if ver=$("$2" --version 2>/dev/null | head -n 1) && [ -n "$ver" ]; then
    echo "ok       $1: $ver"
  elif [ "$3" = 1 ]; then
    echo "MISSING  $1 ($2): $4"
    missing=1
  else
    echo "optional $1 ($2) not found: $4"
  fi
}

check bun bun 1 "install from https://bun.sh"
check clang "${CHAD_CLANG:-clang}" 1 "brew install llvm, or apt install clang-18 (then CHAD_CLANG=clang-18)"
check opt "${CHAD_OPT:-opt}" 1 "brew install llvm, or apt install llvm-18 (then CHAD_OPT=opt-18)"

milo=${CHAD_MILO:-$root/.milo/milo}
if [ -e "$milo" ]; then
  echo "ok       milo: $milo"
else
  echo "MISSING  milo: run sh scripts/setup-milo.sh"
  missing=1
fi
if [ -d "$root/node_modules/typescript" ]; then
  echo "ok       dependencies: node_modules"
else
  echo "MISSING  dependencies: run bun install"
  missing=1
fi

check node node 0 "only needed to run the test suite (Node is the oracle)"
check rustc rustc 0 "only needed for the benchmarks"

if [ "$missing" = 0 ]; then echo "ready: bin/chad can build programs"; else exit 1; fi
