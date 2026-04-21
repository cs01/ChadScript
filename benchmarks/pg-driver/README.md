# Postgres driver benchmark

SELECT-1 throughput loop, single connection, 10000 iterations, median of 3 runs. Measures client-side protocol overhead + parser — the per-query work on the pg server is identical across variants.

## Variants

| Variant                               | Command                                         | Notes                             |
| ------------------------------------- | ----------------------------------------------- | --------------------------------- |
| ChadScript (pure-TS, compiled native) | `chad build bench-chad.ts -o /tmp/b && /tmp/b`  | Simple protocol, text-mode.       |
| pg on Node                            | `node bench-node-pg.mjs`                        | `pg@^8`.                          |
| postgres.js on Node                   | `node bench-postgres-js.mjs`                    | `postgres@^3`.                    |
| postgres.js on Bun                    | `bun bench-postgres-js.mjs`                     | Same script, Bun runtime.         |
| Bun.SQL (native)                      | `bun bench-bun-native.mjs`                      | Bun's first-party C++ pg binding. |
| C (libpq)                             | `cc bench-c.c ... -lpq -O2 -o /tmp/b && /tmp/b` | Reference ceiling.                |
| Go (pgx)                              | `cd bench-go && go build -o /tmp/b && /tmp/b`   | `pgx/v5`.                         |

`run-all.sh` drives all of them and prints a summary. Defaults to `PGUSER=csmith PGDATABASE=postgres` — override via env for your pg instance.

## Result format

Each binary prints:

```
<label> iters=10000 runs=3
runs_ms=<min>,<med>,<max>
median_ms=<N> qps=<N>
```

## Representative numbers (macOS M-series, local pg)

| Variant                           | qps        |
| --------------------------------- | ---------- |
| C (libpq)                         | 58,139     |
| **ChadScript (pure-TS → native)** | **52,023** |
| postgres.js on Bun                | 48,780     |
| Bun.SQL (native)                  | 47,170     |
| pg on Node                        | 37,594     |
| postgres.js on Node               | 35,587     |
| Go (pgx)                          | 32,786     |

Your numbers will differ based on hardware, pg config, and coincident load. The ordering has been stable across ~10 runs in the above setup.
