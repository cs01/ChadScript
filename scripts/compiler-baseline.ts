// Dual-host compiler baseline capture (salvage plan PR 0.2 / "record a trustworthy baseline").
//
// Compiles every discovered fixture with BOTH the node-hosted and native-hosted compilers
// into clean, separate build directories and records a normalized, deterministic JSON
// snapshot of what actually happened: compile status, exit code, signal, whether an
// executable was produced, and (for run fixtures) the executable's exit and output.
//
// Design goals (from the plan's acceptance criteria):
//   - Deterministic across two consecutive runs (`--verify-deterministic` proves it).
//   - A stale native compiler cannot be selected accidentally (freshness guard).
//   - Infrastructure failures are distinguishable from compiler failures (status enum).

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { discoverTests, TestCase } from "../tests/test-discovery";

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const COMPILE_TIMEOUT_MS = 60_000;
const RUN_TIMEOUT_MS = 30_000;
// Cap stored output so the committed baseline stays reviewable; the full output is still
// pinned by a sha256 alongside the (truncated) text.
const MAX_OUTPUT_CHARS = 4_000;

// Compile outcome classification. `crash` and `infra-error` are the categories the plan
// insists must never masquerade as a legitimate `compile-error`.
type CompileStatus =
  | "ok" // exit 0, executable produced
  | "compile-error" // clean nonzero exit, no executable
  | "crash" // killed by a signal, or timed out
  | "infra-error" // could not run the compiler at all
  | "anomaly"; // internally inconsistent (exit 0 w/o exe, or nonzero w/ exe)

interface HostCompileResult {
  status: CompileStatus;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  producedExe: boolean;
  outputSha256: string;
  // True when the compiler emitted control/garbage bytes (e.g. uninitialized memory in a
  // diagnostic). Such bytes vary run-to-run, so they are collapsed to a stable token in
  // `output` — this flag preserves the signal that they occurred.
  hasNonPrintable: boolean;
  output: string; // normalized: ANSI-stripped, path-tokenized, garbage-collapsed, truncated
}

interface HostRunResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  containsTestPassed: boolean;
  hasNonPrintable: boolean;
  outputSha256: string;
  output: string;
}

interface HostResult {
  compile: HostCompileResult;
  run?: HostRunResult; // only when compile.status === "ok" and the fixture is a run fixture
}

type FixtureKind = "run" | "exit-code" | "compile-error";

interface FixtureBaseline {
  name: string;
  fixture: string;
  kind: FixtureKind;
  hosts: Record<string, HostResult | { skipped: string }>;
}

function fixtureKind(tc: TestCase): FixtureKind {
  if (tc.compileError) return "compile-error";
  if (tc.expectedExitCode !== undefined) return "exit-code";
  return "run";
}

// Control/garbage bytes that vary run-to-run (uninitialized memory leaking into a
// diagnostic) — everything non-printable except tab/newline/CR, plus the Unicode
// replacement char. Legitimate multibyte Unicode (e.g. "—") is already a printable code
// point after UTF-8 decode and is intentionally NOT matched. Non-global for `test`, a
// separate global literal for `replace`, to avoid any shared lastIndex state.
const NONPRINTABLE_CLASS = "[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F\\uFFFD]";

// Strip ANSI color codes and replace environment-specific absolute paths with stable
// tokens so the same program yields byte-identical output regardless of where it is built.
function normalize(raw: string, buildDir: string): { text: string; hasNonPrintable: boolean } {
  let s = raw.replace(/\x1b\[[0-9;]*m/g, "");
  const absBuild = path.resolve(projectRoot, buildDir);
  s = s.split(absBuild).join("<BUILD>");
  s = s.split(buildDir).join("<BUILD>");
  s = s.split(projectRoot).join("<ROOT>");
  // Home dir (e.g. clang absolute include paths) is machine-specific.
  s = s.split(os.homedir()).join("<HOME>");
  const hasNonPrintable = new RegExp(NONPRINTABLE_CLASS).test(s);
  s = s.replace(new RegExp(NONPRINTABLE_CLASS + "+", "g"), "<NONPRINT>");
  return { text: s, hasNonPrintable };
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function truncate(s: string): string {
  return s.length > MAX_OUTPUT_CHARS ? s.slice(0, MAX_OUTPUT_CHARS) + "\n…<truncated>" : s;
}

function classifyCompile(err: any, producedExe: boolean): CompileStatus {
  if (err === null) {
    // Compiler exited 0.
    return producedExe ? "ok" : "anomaly";
  }
  if (err.code === "ENOENT") return "infra-error";
  if (err.killed) return "crash"; // timeout kill
  if (err.signal) return "crash"; // SIGSEGV/SIGABRT/…
  if (typeof err.code === "number" && err.code !== 0) {
    return producedExe ? "anomaly" : "compile-error";
  }
  return "infra-error";
}

async function compileFixture(
  compilerCmd: string,
  fixture: string,
  buildDir: string,
): Promise<HostCompileResult> {
  const base = path.basename(fixture, path.extname(fixture));
  const outDir = path.join(buildDir, path.dirname(fixture));
  fs.mkdirSync(path.join(projectRoot, outDir), { recursive: true });
  const exeFile = path.join(outDir, base);
  const exeAbs = path.join(projectRoot, exeFile);
  try {
    fs.rmSync(exeAbs, { force: true });
  } catch {}

  let err: any = null;
  let stdout = "";
  let stderr = "";
  try {
    const r = await execAsync(`${compilerCmd} build ${fixture} -o ${exeFile}`, {
      cwd: projectRoot,
      timeout: COMPILE_TIMEOUT_MS,
    });
    stdout = r.stdout;
    stderr = r.stderr;
  } catch (e: any) {
    err = e;
    stdout = e.stdout || "";
    stderr = e.stderr || "";
  }
  const producedExe = fs.existsSync(exeAbs);
  const combined = normalize(stderr + stdout, buildDir);
  return {
    status: classifyCompile(err, producedExe),
    exitCode: err ? (typeof err.code === "number" ? err.code : null) : 0,
    signal: err?.signal ?? null,
    timedOut: Boolean(err?.killed),
    producedExe,
    outputSha256: sha256(combined.text),
    hasNonPrintable: combined.hasNonPrintable,
    output: truncate(combined.text),
  };
}

async function runExe(tc: TestCase, buildDir: string): Promise<HostRunResult> {
  const base = path.basename(tc.fixture, path.extname(tc.fixture));
  const exeFile = path.join(buildDir, path.dirname(tc.fixture), base);
  const args = tc.args ? " " + tc.args.join(" ") : "";
  let err: any = null;
  let stdout = "";
  try {
    const r = await execAsync(`${exeFile}${args}`, {
      cwd: projectRoot,
      timeout: RUN_TIMEOUT_MS,
    });
    stdout = r.stdout;
  } catch (e: any) {
    err = e;
    stdout = e.stdout || "";
  }
  const normalized = normalize(stdout, buildDir);
  return {
    exitCode: err ? (typeof err.code === "number" ? err.code : null) : 0,
    signal: err?.signal ?? null,
    timedOut: Boolean(err?.killed),
    containsTestPassed: stdout.includes("TEST_PASSED"),
    hasNonPrintable: normalized.hasNonPrintable,
    outputSha256: sha256(normalized.text),
    output: truncate(normalized.text),
  };
}

interface HostSpec {
  label: string;
  command: string;
  buildDir: string;
}

// Newest mtime across src/**/*.ts — used to detect a stale native compiler binary.
function newestSrcMtime(): number {
  let newest = 0;
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(full);
      } else if (full.endsWith(".ts")) {
        const mt = fs.statSync(full).mtimeMs;
        if (mt > newest) newest = mt;
      }
    }
  };
  walk(path.join(projectRoot, "src"));
  return newest;
}

function fileSha256(p: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function gitSha(): string {
  try {
    return require("node:child_process")
      .execSync("git rev-parse HEAD", { cwd: projectRoot })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

// Guard against the classic footgun: a `.build/chad` compiled from stale source silently
// producing a baseline that does not reflect the current tree. Refuse unless overridden.
function assertNativeFresh(
  nativePath: string,
  allowStale: boolean,
): { sha256: string; stale: boolean } {
  const abs = path.isAbsolute(nativePath) ? nativePath : path.join(projectRoot, nativePath);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `native compiler not found at ${nativePath}. Build it first:\n` +
        `  rm -f .build/chad && node dist/chad-node.js build src/chad-native.ts -o .build/chad`,
    );
  }
  const binMtime = fs.statSync(abs).mtimeMs;
  const stale = binMtime < newestSrcMtime();
  if (stale && !allowStale) {
    throw new Error(
      `native compiler at ${nativePath} is STALE (older than src/). A stale binary yields a ` +
        `misleading baseline. Rebuild it, or pass --allow-stale to record it anyway:\n` +
        `  rm -f .build/chad && node dist/chad-node.js build src/chad-native.ts -o .build/chad`,
    );
  }
  return { sha256: fileSha256(abs), stale };
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

function parseArgs(argv: string[]) {
  const opts: {
    node: string;
    native: string;
    out: string;
    allowStale: boolean;
    verifyDeterministic: boolean;
    filter: string | null;
    concurrency: number;
  } = {
    node: "node dist/chad-node.js",
    native: ".build/chad",
    out: "tests/baseline/compiler-baseline.json",
    allowStale: false,
    verifyDeterministic: false,
    filter: null,
    concurrency: 8,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--node") opts.node = argv[++i];
    else if (a === "--native") opts.native = argv[++i];
    else if (a === "--out") opts.out = argv[++i];
    else if (a === "--allow-stale") opts.allowStale = true;
    else if (a === "--verify-deterministic") opts.verifyDeterministic = true;
    else if (a === "--filter") opts.filter = argv[++i];
    else if (a === "--concurrency") opts.concurrency = parseInt(argv[++i], 10);
    else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

async function collectFixture(tc: TestCase, hosts: HostSpec[]): Promise<FixtureBaseline> {
  const kind = fixtureKind(tc);
  const hostResults: Record<string, HostResult | { skipped: string }> = {};
  for (const host of hosts) {
    if (tc.nativeOnly && host.label === "node") {
      hostResults[host.label] = { skipped: "native-only fixture" };
      continue;
    }
    const compile = await compileFixture(host.command, tc.fixture, host.buildDir);
    const result: HostResult = { compile };
    if (compile.status === "ok" && kind !== "compile-error") {
      result.run = await runExe(tc, host.buildDir);
    }
    hostResults[host.label] = result;
  }
  return { name: tc.name, fixture: tc.fixture, kind, hosts: hostResults };
}

async function collectAll(opts: ReturnType<typeof parseArgs>): Promise<FixtureBaseline[]> {
  const hosts: HostSpec[] = [
    { label: "node", command: opts.node, buildDir: ".baseline-build/node" },
    { label: "native", command: opts.native, buildDir: ".baseline-build/native" },
  ];
  // Clean, separate build dirs so no stale artifact from a prior run leaks in.
  for (const h of hosts)
    fs.rmSync(path.join(projectRoot, h.buildDir), { recursive: true, force: true });

  let cases = discoverTests()
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  if (opts.filter) cases = cases.filter((c) => c.fixture.includes(opts.filter!));

  const results = await mapLimit(cases, opts.concurrency, (tc) => collectFixture(tc, hosts));
  // Deterministic order regardless of completion order.
  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const native = assertNativeFresh(opts.native, opts.allowStale);

  if (opts.verifyDeterministic) {
    const a = await collectAll(opts);
    const b = await collectAll(opts);
    const sa = JSON.stringify(a);
    const sb = JSON.stringify(b);
    if (sa !== sb) {
      console.error("NON-DETERMINISTIC: two consecutive baseline runs differed.");
      process.exit(1);
    }
    console.log(`deterministic: two runs identical (${a.length} fixtures)`);
    return;
  }

  const results = await collectAll(opts);

  // `meta` is environment-descriptive (platform/compiler identity); it is intentionally
  // NOT part of the determinism comparison, which covers only per-fixture `results`.
  const doc = {
    meta: {
      platform: `${os.platform()}-${os.arch()}`,
      gitSha: gitSha(),
      nodeCompiler: opts.node,
      nativeCompiler: opts.native,
      nativeSha256: native.sha256,
      nativeStale: native.stale,
      fixtureCount: results.length,
    },
    results,
  };

  // Tally by (host, status) so a reviewer sees the shape at a glance.
  const tally: Record<string, number> = {};
  for (const r of results) {
    for (const [label, hr] of Object.entries(r.hosts)) {
      if ("skipped" in hr) continue;
      const key = `${label}:${hr.compile.status}`;
      tally[key] = (tally[key] || 0) + 1;
    }
  }

  const outAbs = path.resolve(projectRoot, opts.out);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, JSON.stringify(doc, null, 2) + "\n");

  console.log(`baseline: ${results.length} fixtures → ${opts.out}`);
  for (const key of Object.keys(tally).sort()) console.log(`  ${key}: ${tally[key]}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
