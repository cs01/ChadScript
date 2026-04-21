#!/usr/bin/env bash
# Run all pg-driver benchmarks, print a summary table.
set -e
cd "$(dirname "$0")"

OUT=results.txt
: > $OUT

# Defaults for local pg (adjust via PGUSER/PGDATABASE/PGPASSWORD).
: "${PGUSER:=csmith}"
: "${PGDATABASE:=postgres}"
: "${PGPASSWORD:=}"
export PGUSER PGDATABASE PGPASSWORD

run() {
    local label="$1"; shift
    echo "▸ $label" | tee -a $OUT
    if "$@" | tee -a $OUT; then :; else echo "  (FAILED)" | tee -a $OUT; fi
    echo "" | tee -a $OUT
}

# ChadScript (native)
if [ ! -f /tmp/bench-chad ]; then
    echo "==> building chad bench"
    (cd ../.. && node dist/chad-node.js build benchmarks/pg-driver/bench-chad.ts -o /tmp/bench-chad)
fi
run "ChadScript (pure-TS → native)" /tmp/bench-chad

# node-pg
if [ ! -d node_modules ]; then npm install >/dev/null 2>&1; fi
run "pg on Node" node bench-node-pg.mjs
run "postgres.js on Node" node bench-postgres-js.mjs

# bun
if command -v bun >/dev/null 2>&1; then
    run "postgres.js on Bun" bun bench-postgres-js.mjs
    run "Bun.SQL native" bun bench-bun-native.mjs
else
    echo "▸ bun — SKIPPED (bun not in PATH)" | tee -a $OUT
fi

# C (libpq)
LIBPQ_PREFIX="$(brew --prefix libpq 2>/dev/null || echo /usr/local/opt/libpq)"
if [ ! -f /tmp/bench-c ]; then
    cc bench-c.c -I"$LIBPQ_PREFIX/include" -L"$LIBPQ_PREFIX/lib" -lpq -O2 -o /tmp/bench-c
fi
run "C (libpq)" /tmp/bench-c

# Go (pgx)
if command -v go >/dev/null 2>&1; then
    (cd bench-go && go mod tidy >/dev/null 2>&1 && go build -o /tmp/bench-go)
    run "Go (pgx)" /tmp/bench-go
else
    echo "▸ go — SKIPPED (go not in PATH)" | tee -a $OUT
fi

echo ""
echo "==== SUMMARY ===="
grep -E "^(chad|node-pg|postgres.js|c-libpq|go-pgx)" $OUT | grep "median_ms=" | sort
