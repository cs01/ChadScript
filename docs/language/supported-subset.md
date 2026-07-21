# Supported language subset

ChadScript compiles a **subset** of TypeScript to native code. It does **not** claim general
TypeScript compatibility. This page is the support contract: what the compiler is expected to
accept, what it is expected to reject with a diagnostic, and what is currently unclassified.

The contract is derived mechanically from the dual-host baseline (the node-hosted and
native-hosted compilers must agree). The machine-readable form lives in
[`tests/support-matrix.json`](../../tests/support-matrix.json).

## Categories

- **supported** — both hosts compile the fixture and it runs to its expected outcome.
- **rejected-with-diagnostic** — both hosts reject the program with a clean compile-error
  diagnostic (no crash, no arbitrary exit — see the negative-fixture contract).
- **unknown** — everything else: the two hosts disagree, the program fails unexpectedly, or
  compilation ends in an anomaly. An `unknown` is never promoted to `supported` just because
  one host happens to pass; these are the gaps to close.

## Regenerating

```bash
npm run baseline          # record the dual-host baseline
npm run support-matrix    # regenerate the matrix + the block below
```

<!-- GENERATED:support-matrix START -->

_Generated from the dual-host baseline over 690 fixtures._

| Status | Count |
| --- | ---: |
| supported | 645 |
| rejected-with-diagnostic | 45 |
| unknown | 0 |

### By category

| Category | supported | rejected | unknown |
| --- | ---: | ---: | ---: |
| argparse | 3 | 0 | 0 |
| arithmetic | 20 | 0 | 0 |
| arrays | 78 | 0 | 0 |
| async | 1 | 0 | 0 |
| bitwise | 2 | 0 | 0 |
| builtins | 121 | 2 | 0 |
| classes | 60 | 2 | 0 |
| closures | 7 | 4 | 0 |
| closures-cabi | 7 | 0 | 0 |
| collections | 4 | 0 | 0 |
| comparisons | 5 | 0 | 0 |
| control-flow | 29 | 0 | 0 |
| crypto | 3 | 0 | 0 |
| data-structures | 20 | 1 | 0 |
| destructuring | 4 | 0 | 0 |
| edge-cases | 71 | 8 | 0 |
| error-handling | 10 | 0 | 0 |
| errors | 0 | 14 | 0 |
| functions | 9 | 0 | 0 |
| generics | 9 | 0 | 0 |
| globals | 6 | 0 | 0 |
| imports-exports | 3 | 0 | 0 |
| interfaces | 25 | 0 | 0 |
| jsx | 6 | 0 | 0 |
| logical | 3 | 0 | 0 |
| maps | 3 | 0 | 0 |
| math | 9 | 0 | 0 |
| net | 2 | 0 | 0 |
| network | 12 | 0 | 0 |
| objects | 12 | 0 | 0 |
| optimization | 1 | 0 | 0 |
| optional-chaining | 1 | 0 | 0 |
| regex | 5 | 0 | 0 |
| semantic | 3 | 8 | 0 |
| stdlib | 6 | 0 | 0 |
| strings | 62 | 1 | 0 |
| structs | 1 | 0 | 0 |
| test-runner | 4 | 0 | 0 |
| typed-arrays | 3 | 0 | 0 |
| types | 10 | 5 | 0 |
| typescript | 2 | 0 | 0 |
| variables | 2 | 0 | 0 |
| websocket | 1 | 0 | 0 |

### Unknown (0) — the honest gaps

_None._

<!-- GENERATED:support-matrix END -->
