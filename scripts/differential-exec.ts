// Differential execution harness (salvage plan PR 2.2 / "add differential execution").
//
// For each PURE-LANGUAGE fixture, run the original program two ways and compare:
//   oracle   — `tsx <fixture>` (Node's JS semantics)
//   compiled — the ChadScript node-host compiler's native binary
// A divergence in stdout or exit status is either a Node-incompatibility in the fixture or,
// more interestingly, a miscompilation in the node/TS reference compiler's LLVM output.
//
// Scope: only the pure-language subset. Fixtures that touch ChadScript-specific stdlib/FFI
// (fs, http, sqlite, fetch, child_process, crypto, typed JSON.parse<T>, argv, imports) are
// excluded — the plan says give those contract tests, not Node differential tests.
//
// Run:  npm run diff-exec            (all pure fixtures)
//       npm run diff-exec -- --filter arrays/

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverTests, TestCase } from "../tests/test-discovery";

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const COMPILE_TIMEOUT_MS = 60_000;
const RUN_TIMEOUT_MS = 20_000;
const NODE_COMPILER = "node dist/chad-node.js";
const BUILD_DIR = ".diff-build";

// Source patterns that make a fixture unsuitable for a Node differential (ChadScript-specific
// runtime behavior, host IO/FFI, or argv semantics that differ between `tsx` and a native exe).
const IMPURE_PATTERNS: RegExp[] = [
  /^\s*import\s/m,
  /\brequire\s*\(/,
  /\bhttpServe\b/,
  /\bhttpGet\b/,
  /\bRouter\b/,
  /\bsqlite\b/,
  /\bfetch\s*\(/,
  /\bchild_process\b/,
  /\bWebSocket\b/,
  /\bSocket\b/,
  /\bcreateServer\b/,
  /\bconnect\s*\(/,
  /\bsocket\s*\(/, // low-level socket() syscall builtin — not present in Node
  /\bconsole\.time\b/,
  /\bprocess\.argv\b/,
  /\breadFileSync\b|\bwriteFileSync\b|\bfs\./,
  /\bcrypto\./,
  /\bJSON\.parse\s*</, // typed JSON.parse<T>() is ChadScript-specific
  /\bBuffer\b/,
  /\bDeno\b/,
];

function isPure(source: string): boolean {
  return !IMPURE_PATTERNS.some((re) => re.test(source));
}

type Verdict =
  | "match"
  | "stdout-mismatch"
  | "exit-mismatch"
  | "compile-failed" // node compiler could not build a fixture we thought was supported
  | "oracle-unrunnable"; // tsx can't run it (not differentiable) — excluded from pass/fail

interface Outcome {
  stdout: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  errored: boolean;
}

interface DiffRow {
  fixture: string;
  verdict: Verdict;
  detail?: string;
}

// Trailing-whitespace-insensitive line compare; keeps interior content exact.
function normalizeStdout(s: string): string {
  return s
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}

async function runCmd(cmd: string, timeout: number): Promise<Outcome> {
  try {
    const r = await execAsync(cmd, { cwd: projectRoot, timeout });
    return { stdout: r.stdout, exitCode: 0, signal: null, timedOut: false, errored: false };
  } catch (e: any) {
    return {
      stdout: e.stdout || "",
      exitCode: typeof e.code === "number" ? e.code : null,
      signal: e.signal ?? null,
      timedOut: Boolean(e.killed),
      errored: true,
    };
  }
}

async function differential(tc: TestCase): Promise<DiffRow> {
  const args = tc.args ? " " + tc.args.join(" ") : "";

  // Oracle: run the .ts under Node via tsx.
  const oracle = await runCmd(`node --import tsx ${tc.fixture}${args}`, RUN_TIMEOUT_MS);
  // If Node itself can't run it (uses something outside plain JS), it isn't differentiable.
  if (oracle.errored && oracle.signal) {
    return {
      fixture: tc.fixture,
      verdict: "oracle-unrunnable",
      detail: `tsx signal ${oracle.signal}`,
    };
  }
  // A non-zero tsx exit is only "unrunnable" if this isn't an exit-code fixture expecting it.
  if (oracle.errored && tc.expectedExitCode === undefined && oracle.exitCode !== 0) {
    return {
      fixture: tc.fixture,
      verdict: "oracle-unrunnable",
      detail: `tsx exited ${oracle.exitCode}`,
    };
  }

  // Compiled: build with the node-host compiler, then run the binary.
  const base = path.basename(tc.fixture, path.extname(tc.fixture));
  const outDir = path.join(BUILD_DIR, path.dirname(tc.fixture));
  fs.mkdirSync(path.join(projectRoot, outDir), { recursive: true });
  const exe = path.join(outDir, base);
  const build = await runCmd(`${NODE_COMPILER} build ${tc.fixture} -o ${exe}`, COMPILE_TIMEOUT_MS);
  if (build.errored || !fs.existsSync(path.join(projectRoot, exe))) {
    return { fixture: tc.fixture, verdict: "compile-failed", detail: build.stdout.slice(0, 200) };
  }
  const compiled = await runCmd(`${exe}${args}`, RUN_TIMEOUT_MS);

  const oStd = normalizeStdout(oracle.stdout);
  const cStd = normalizeStdout(compiled.stdout);
  const oExit = oracle.errored ? oracle.exitCode : 0;
  const cExit = compiled.errored ? compiled.exitCode : 0;

  if (oStd !== cStd) {
    const firstDiff = firstDiffLine(oStd, cStd);
    return { fixture: tc.fixture, verdict: "stdout-mismatch", detail: firstDiff };
  }
  if (oExit !== cExit) {
    return {
      fixture: tc.fixture,
      verdict: "exit-mismatch",
      detail: `node=${oExit} compiled=${cExit}`,
    };
  }
  return { fixture: tc.fixture, verdict: "match" };
}

function firstDiffLine(a: string, b: string): string {
  const la = a.split("\n");
  const lb = b.split("\n");
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i++) {
    if (la[i] !== lb[i]) {
      return `line ${i + 1}: node=${JSON.stringify(la[i] ?? "<none>")} compiled=${JSON.stringify(lb[i] ?? "<none>")}`;
    }
  }
  return "differs (no line pinpoint)";
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const ALLOWLIST_PATH = "tests/baseline/differential-divergences.json";

// Known, accepted divergences: fixture -> {category, note}. Most are intentional
// ChadScript-vs-JS semantic differences (error stringification, boolean formatting, OOB
// handling, console object formatting). A few are suspected miscompiles tracked for a fix.
// The harness fails only on divergences NOT listed here (regressions).
type Allowlist = Record<string, { category: string; note: string }>;

function loadAllowlist(): Allowlist {
  const abs = path.resolve(projectRoot, ALLOWLIST_PATH);
  if (!fs.existsSync(abs)) return {};
  return JSON.parse(fs.readFileSync(abs, "utf8")).divergences ?? {};
}

async function main() {
  const argv = process.argv.slice(2);
  let filter: string | null = null;
  let concurrency = 8;
  let updateAllowlist = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--filter") filter = argv[++i];
    else if (argv[i] === "--concurrency") concurrency = parseInt(argv[++i], 10);
    // Regenerate the allowlist from the current divergences, preserving existing categories/notes.
    else if (argv[i] === "--update-allowlist") updateAllowlist = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }

  fs.rmSync(path.join(projectRoot, BUILD_DIR), { recursive: true, force: true });

  let cases = discoverTests().filter(
    (tc) => !tc.compileError && (tc.expectTestPassed || tc.expectedExitCode !== undefined),
  );
  if (filter) cases = cases.filter((c) => c.fixture.includes(filter!));

  // Keep only pure-language fixtures.
  const pure = cases.filter((tc) =>
    isPure(fs.readFileSync(path.join(projectRoot, tc.fixture), "utf8")),
  );
  const excluded = cases.length - pure.length;
  pure.sort((a, b) => a.fixture.localeCompare(b.fixture));

  const rows = await mapLimit(pure, concurrency, differential);

  const tally: Record<Verdict, number> = {
    match: 0,
    "stdout-mismatch": 0,
    "exit-mismatch": 0,
    "compile-failed": 0,
    "oracle-unrunnable": 0,
  };
  for (const r of rows) tally[r.verdict]++;

  const report = {
    meta: {
      note: "Differential execution: `tsx` (Node oracle) vs the node-host-compiled binary, pure-language fixtures only.",
      totalRunFixtures: cases.length,
      excludedImpure: excluded,
      tested: pure.length,
      tally,
    },
    divergences: rows.filter(
      (r) => r.verdict === "stdout-mismatch" || r.verdict === "exit-mismatch",
    ),
    compileFailed: rows.filter((r) => r.verdict === "compile-failed").map((r) => r.fixture),
    oracleUnrunnable: rows.filter((r) => r.verdict === "oracle-unrunnable").map((r) => r.fixture),
  };
  const outAbs = path.resolve(projectRoot, "tests/baseline/differential-exec.json");
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, JSON.stringify(report, null, 2) + "\n");

  console.log(`differential: tested ${pure.length} pure fixtures (${excluded} impure excluded)`);
  for (const k of Object.keys(tally) as Verdict[]) console.log(`  ${k}: ${tally[k]}`);

  const divergences = report.divergences;
  const allowlist = loadAllowlist();

  if (updateAllowlist) {
    // Rebuild the allowlist from current divergences, keeping prior category/note where known.
    const next: Allowlist = {};
    for (const d of divergences.sort((a, b) => a.fixture.localeCompare(b.fixture))) {
      next[d.fixture] = allowlist[d.fixture] ?? { category: "UNCATEGORIZED", note: d.detail ?? "" };
    }
    const alAbs = path.resolve(projectRoot, ALLOWLIST_PATH);
    fs.writeFileSync(
      alAbs,
      JSON.stringify(
        {
          note: "Known divergences between the ChadScript-compiled binary and the Node oracle.",
          divergences: next,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`\nallowlist updated: ${Object.keys(next).length} entries → ${ALLOWLIST_PATH}`);
    return;
  }

  const unexpected = divergences.filter((d) => !(d.fixture in allowlist));
  // A stale entry is one we actually TESTED this run that no longer diverges. Under --filter,
  // untested allowlist entries must not be reported as stale (they were simply not run).
  const testedFixtures = new Set(pure.map((p) => p.fixture));
  const stale = Object.keys(allowlist).filter(
    (f) => testedFixtures.has(f) && !divergences.some((d) => d.fixture === f),
  );

  if (divergences.length > 0) {
    console.log(
      `\ndivergences: ${divergences.length} (${divergences.length - unexpected.length} known)`,
    );
  }
  if (stale.length > 0) {
    console.log(`\nSTALE allowlist entries (no longer diverge — likely fixed, remove them):`);
    for (const f of stale) console.log(`  ${f}`);
  }
  if (unexpected.length > 0) {
    console.log(`\nUNEXPECTED divergences (compiled ≠ Node, not in allowlist — a regression):`);
    for (const d of unexpected) console.log(`  ${d.fixture}\n    ${d.detail}`);
  }
  // Fail only on NEW divergences. Known ones are tracked in the allowlist; stale entries are
  // informational (a fix to celebrate + prune), not a failure.
  process.exit(unexpected.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(2);
});
