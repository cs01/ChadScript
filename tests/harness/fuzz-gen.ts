// Grammar-based program generator for the differential fuzzer. Emits small, deterministic
// programs over the ACCEPTED Phase-1 subset (number/boolean vars, every operator category,
// console.log). Every generated program must (a) pass the tsc gate + validator and (b) run
// deterministically, so any native-vs-Node divergence is a real miscompile — never a fuzzer
// artifact. Determinism comes from a seeded PRNG; a seed reproduces the exact program set.
//
// Soundness notes:
//   - Numeric vars are declared with `let` so they widen to `number`; this keeps `===`/`!==`
//     off the "distinct literal types have no overlap" tsc error, and lets any operator apply.
//   - Division / modulo / Infinity / NaN are all fair game: v2 formats f64 exactly like Node,
//     so their textual output agrees. No need for v1's integer-only restriction.

// Deterministic PRNG (mulberry32) — same seed ⇒ same programs.
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NUM_BINOPS = ["+", "-", "*", "/", "%", "&", "|", "^", "<<", ">>", ">>>"];
const CMP_OPS = ["<", ">", "<=", ">=", "===", "!=="];
// Literals chosen to exercise edges: zero, negatives, fractions, and values that stress ToInt32
// (past 2^31 / 2^32) and shift-count masking.
// Non-negative only: unary minus is generated separately, and a bare `-4` adjacent to a
// generated `-` would lex as `--` (decrement), which tsc rejects.
const NUM_LITERALS = [
  "0",
  "1",
  "2",
  "3",
  "7",
  "10",
  "0.5",
  "3.14",
  "100",
  "255",
  "2147483647",
  "2147483648",
  "4294967296",
  "40",
];

interface Gen {
  rng: () => number;
  vars: string[]; // in-scope numeric variable names
}

function pick<T>(g: Gen, xs: readonly T[]): T {
  return xs[Math.floor(g.rng() * xs.length)]!;
}

// A number-typed expression up to `depth` deep.
function numExpr(g: Gen, depth: number): string {
  if (depth <= 0 || g.rng() < 0.35) {
    return g.vars.length && g.rng() < 0.6 ? pick(g, g.vars) : pick(g, NUM_LITERALS);
  }
  const r = g.rng();
  if (r < 0.15) return `(-${numExpr(g, depth - 1)})`;
  if (r < 0.25) return `(~${numExpr(g, depth - 1)})`;
  return `(${numExpr(g, depth - 1)} ${pick(g, NUM_BINOPS)} ${numExpr(g, depth - 1)})`;
}

// A `number`-typed operand for a comparison — never a bare literal, so `===`/`!==` never hit
// tsc's "distinct literal types have no overlap" error. `... + 0` forces the `number` type
// while preserving the compared value (NaN/Infinity/±0 all compare identically after `+ 0`).
function numOperand(g: Gen, depth: number): string {
  if (g.vars.length && g.rng() < 0.7) return pick(g, g.vars);
  return `(${numExpr(g, depth)} + 0)`;
}

// A boolean-typed expression: comparisons combined with &&/||/!.
function boolExpr(g: Gen, depth: number): string {
  if (depth <= 0 || g.rng() < 0.5) {
    return `(${numOperand(g, depth)} ${pick(g, CMP_OPS)} ${numOperand(g, depth)})`;
  }
  const r = g.rng();
  if (r < 0.25) return `(!${boolExpr(g, depth - 1)})`;
  const op = g.rng() < 0.5 ? "&&" : "||";
  return `(${boolExpr(g, depth - 1)} ${op} ${boolExpr(g, depth - 1)})`;
}

// A complete program: declare a few numeric vars, then print a mix of number/boolean values.
export function genProgram(seed: number): string {
  const g: Gen = { rng: makeRng(seed), vars: [] };
  const lines: string[] = [];
  const nVars = 2 + Math.floor(g.rng() * 3);
  for (let i = 0; i < nVars; i++) {
    const name = `v${i}`;
    lines.push(`let ${name} = ${numExpr(g, 1)};`);
    g.vars.push(name);
  }
  const nPrints = 3 + Math.floor(g.rng() * 4);
  for (let i = 0; i < nPrints; i++) {
    const expr = g.rng() < 0.6 ? numExpr(g, 3) : boolExpr(g, 3);
    lines.push(`console.log(${expr});`);
  }
  return lines.join("\n") + "\n";
}
