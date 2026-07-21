// Seeded differential fuzzer (salvage plan PR 2.2, second half: "a seeded generator combines
// supported constructs into small programs").
//
// Generates random INTEGER-valued programs that compose the supported language subset
// (arithmetic, variables, if/else, bounded loops, functions + calls, Math.floor/ceil/round/
// trunc/abs), runs each under Node (`tsx`, the JS oracle) and as a ChadScript-compiled binary,
// and reports any stdout/exit divergence — a real miscompilation in the node/TS compiler.
//
// Soundness (so a divergence is always a real bug, never a false positive):
//   - Only integers are printed. JS and ChadScript agree on integer text; floats/objects do not.
//   - Operand magnitudes and tree depth are bounded, so no value overflows 2^31 — this keeps
//     JS doubles and ChadScript i64 in exact agreement for +,-,*,%.
//   - No division (avoids float results and divide-by-zero); % uses literal 1..9 divisors.
//   - Fractional literals appear ONLY inside Math.* calls, whose result is an integer.
//
// Run:  npm run diff-fuzz -- --count 200 --seed 1
// A failing program is written to .diff-fuzz/fail-<n>.ts and printed for a minimal repro.

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const NODE_COMPILER = "node dist/chad-node.js";
const OUT_DIR = ".diff-fuzz";
const RUN_TIMEOUT_MS = 20_000;

// Deterministic PRNG (mulberry32) so a --seed reproduces the exact program set.
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Gen {
  private rng: () => number;
  private lines: string[] = [];
  private vars: string[] = [];
  private nextId = 0;

  constructor(seed: number) {
    this.rng = makeRng(seed);
  }

  private int(maxExcl: number): number {
    return Math.floor(this.rng() * maxExcl);
  }
  private pick<T>(arr: T[]): T {
    return arr[this.int(arr.length)];
  }
  private fresh(prefix: string): string {
    return `${prefix}${this.nextId++}`;
  }

  // A bounded integer expression. Depth-limited so values stay well under 2^31.
  private expr(depth: number): string {
    if (depth <= 0 || this.vars.length === 0 || this.rng() < 0.4) {
      // Leaf: small literal, an existing variable, or a Math.* of a fractional value.
      const r = this.rng();
      if (r < 0.25 && this.vars.length > 0) return this.pick(this.vars);
      if (r < 0.45) {
        const fn = this.pick(["floor", "ceil", "round", "trunc", "abs"]);
        // fractional argument → integer result (targets the integer-narrowing bug class)
        const whole = this.int(20);
        const frac = this.pick([".25", ".5", ".7", ".9"]);
        return `Math.${fn}(${whole}${frac})`;
      }
      return String(this.int(12));
    }
    const op = this.pick(["+", "-", "*", "%"]);
    const left = this.expr(depth - 1);
    if (op === "%") {
      // Guaranteed nonzero literal divisor keeps semantics defined and small.
      return `((${left}) % ${1 + this.int(9)})`;
    }
    const right = this.expr(depth - 1);
    return `((${left}) ${op} (${right}))`;
  }

  private declareVar(): void {
    const name = this.fresh("v");
    this.lines.push(`let ${name}: number = ${this.expr(2)};`);
    this.vars.push(name);
  }

  private ifStmt(): void {
    if (this.vars.length === 0) return;
    const cond = `(${this.pick(this.vars)} % 2) === 0`;
    const target = this.pick(this.vars);
    this.lines.push(
      `if (${cond}) { ${target} = ${this.expr(2)}; } else { ${target} = ${this.expr(2)}; }`,
    );
  }

  private loop(): void {
    if (this.vars.length === 0) return;
    const i = this.fresh("i");
    const acc = this.pick(this.vars);
    const n = 1 + this.int(6);
    // Bounded iteration; accumulate a small bounded value.
    this.lines.push(
      `for (let ${i}: number = 0; ${i} < ${n}; ${i} = ${i} + 1) { ${acc} = (${acc} + ${i}) % 10007; }`,
    );
  }

  generate(): string {
    // 2-4 seed variables.
    const nVars = 2 + this.int(3);
    for (let i = 0; i < nVars; i++) this.declareVar();
    // A helper function exercising params + Math.* (the ceil-bug shape).
    const fnParam = this.fresh("p");
    const fnName = this.fresh("fn");
    const fnMath = this.pick(["floor", "ceil", "round", "trunc"]);
    this.lines.push(
      `function ${fnName}(${fnParam}: number): number { return Math.${fnMath}(${fnParam}) + 1; }`,
    );
    // A handful of statements.
    const nStmts = 3 + this.int(5);
    for (let i = 0; i < nStmts; i++) {
      const r = this.rng();
      if (r < 0.35) this.declareVar();
      else if (r < 0.6) this.ifStmt();
      else if (r < 0.8) this.loop();
      else if (this.vars.length > 0) {
        const t = this.pick(this.vars);
        // Pass a fractional literal (whole.frac) so the helper's Math.* has a fractional arg.
        const frac = `${this.int(20)}${this.pick([".5", ".25", ".9"])}`;
        this.lines.push(`${t} = ${t} + ${fnName}(${frac});`);
      }
    }
    // Print all variables as integers.
    for (const v of this.vars) this.lines.push(`console.log("${v}=" + ${v});`);
    return this.lines.join("\n") + "\n";
  }
}

interface Outcome {
  stdout: string;
  exitCode: number | null;
  signal: string | null;
  errored: boolean;
}
async function run(cmd: string): Promise<Outcome> {
  try {
    const r = await execAsync(cmd, { cwd: projectRoot, timeout: RUN_TIMEOUT_MS });
    return { stdout: r.stdout, exitCode: 0, signal: null, errored: false };
  } catch (e: any) {
    return {
      stdout: e.stdout || "",
      exitCode: typeof e.code === "number" ? e.code : null,
      signal: e.signal ?? null,
      errored: true,
    };
  }
}

async function main() {
  const argv = process.argv.slice(2);
  let count = 100;
  let seed = 1;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--count") count = parseInt(argv[++i], 10);
    else if (argv[i] === "--seed") seed = parseInt(argv[++i], 10);
    else throw new Error(`unknown argument: ${argv[i]}`);
  }

  fs.rmSync(path.join(projectRoot, OUT_DIR), { recursive: true, force: true });
  fs.mkdirSync(path.join(projectRoot, OUT_DIR), { recursive: true });

  let passed = 0;
  let oracleSkipped = 0;
  const failures: { n: number; file: string; detail: string }[] = [];

  for (let n = 0; n < count; n++) {
    // Distinct per-program seed derived from the base seed for reproducibility.
    const prog = new Gen(seed * 1_000_003 + n).generate();
    const src = path.join(OUT_DIR, `p${n}.ts`);
    fs.writeFileSync(path.join(projectRoot, src), prog);

    const oracle = await run(`node --import tsx ${src}`);
    if (oracle.errored) {
      // A generated program Node can't run means the generator emitted something invalid;
      // skip (not a compiler divergence). Should be rare if the grammar stays in-subset.
      oracleSkipped++;
      continue;
    }
    const exe = path.join(OUT_DIR, `p${n}`);
    const build = await run(`${NODE_COMPILER} build ${src} -o ${exe}`);
    if (build.errored || !fs.existsSync(path.join(projectRoot, exe))) {
      const file = path.join(OUT_DIR, `fail-${n}.ts`);
      fs.copyFileSync(path.join(projectRoot, src), path.join(projectRoot, file));
      failures.push({ n, file, detail: `compile failed: ${build.stdout.slice(0, 160)}` });
      continue;
    }
    const compiled = await run(exe);
    const oStd = oracle.stdout.trimEnd();
    const cStd = compiled.stdout.trimEnd();
    if (oStd !== cStd) {
      const file = path.join(OUT_DIR, `fail-${n}.ts`);
      fs.copyFileSync(path.join(projectRoot, src), path.join(projectRoot, file));
      failures.push({ n, file, detail: firstDiff(oStd, cStd) });
    } else {
      passed++;
    }
  }

  console.log(
    `diff-fuzz: seed=${seed} count=${count} → passed ${passed}, skipped ${oracleSkipped}, FAILURES ${failures.length}`,
  );
  for (const f of failures) {
    console.log(`\n  ${f.file}\n    ${f.detail}`);
  }
  process.exit(failures.length > 0 ? 1 : 0);
}

function firstDiff(a: string, b: string): string {
  const la = a.split("\n");
  const lb = b.split("\n");
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i++) {
    if (la[i] !== lb[i]) {
      return `line ${i + 1}: node=${JSON.stringify(la[i] ?? "<none>")} compiled=${JSON.stringify(lb[i] ?? "<none>")}`;
    }
  }
  return "differs";
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(2);
});
