// Differential harness: the default proof of correctness. For a fixture, we compare the
// native binary's behavior against Node running the same source, at BOTH -O0 and -O2:
//   - node source            (the oracle)
//   - native -O0             (must equal oracle)
//   - native -O2             (must equal oracle → O0==O2, else an -O2 UB leak)
// and we run `opt -passes=verify` on the emitted IR. Any mismatch is a failure.
//
// "Behavior" is every observable effect, not just stdout: each run executes in its own fresh
// working directory (seeded with a copy of the fixture's sibling `fixtures/` data directory), and
// we compare stdout, stderr (effects.ts has the uncaught-error allowance), the exit code, and the
// full directory tree the run leaves behind.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProgram } from "../../src/frontend/program.js";
import { validate } from "../../src/validate/validate.js";
import { emitIr, linkIr, runtimeObjects } from "../../src/driver/build.js";
import { OPT } from "../../src/driver/toolchain.js";
import { compareStderr, diffTrees, normalizeCwd, prepareRunDir, snapshotTree } from "./effects.js";

const execFileAsync = promisify(execFile);

// A fixture that runs longer than this is treated as a hang (subset programs finish in ms). Kept
// generous so a slow CI box doesn't false-positive.
export const RUN_TIMEOUT_MS = 20_000;

export interface RunResult {
  stdout: string;
  stderr: string;
  exit: number | null; // null when the process was killed by a signal (never exited normally)
  signal: string | null; // e.g. "SIGSEGV" — a crash; null on a normal exit
  timedOut: boolean; // killed by the run timeout — a hang
}

// Run a process and classify how it ended: normal exit (with a code), a signal (crash), or a
// timeout (hang). The predecessor collapsed a signal death into `exit: 1`, which could FALSELY
// match Node's exit 1 (an uncaught error) — a native segfault masquerading as agreement. Keeping
// signal/timeout distinct means a crash or hang can never be mistaken for a matching exit code.
export async function run(
  cmd: string,
  args: string[],
  timeoutMs = RUN_TIMEOUT_MS,
  env: NodeJS.ProcessEnv = process.env,
  cwd?: string,
): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      env,
      cwd,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { stdout, stderr, exit: 0, signal: null, timedOut: false };
  } catch (e) {
    const err = e as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      code?: number | string;
      signal?: string | null;
      killed?: boolean;
    };
    // execFile sets `killed` when IT terminated the child — here that only happens on timeout.
    const timedOut = err.killed === true;
    const signal = !timedOut && typeof err.signal === "string" ? err.signal : null;
    const exit = typeof err.code === "number" ? err.code : null;
    return {
      stdout: (err.stdout ?? "").toString(),
      stderr: (err.stderr ?? "").toString(),
      exit,
      signal,
      timedOut,
    };
  }
}

// The oracle is Node itself, with tsx as a loader only for what plain `node file.ts` lacks:
// TypeScript's module resolution (`./util`, `./util.js`, `./dir`, packages whose entry is `.ts`)
// and syntax that type stripping refuses (parameter properties). Runtime semantics stay Node's.
// tsx is resolved to an absolute URL so the oracle does not depend on the cwd, and its tsconfig
// is pinned so the compiler's own tsconfig.json never shapes how a fixture is transpiled.
const TSX_LOADER = import.meta.resolve("tsx");
const ORACLE_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  TSX_TSCONFIG_PATH: join(dirname(fileURLToPath(import.meta.url)), "oracle-tsconfig.json"),
};

export function runOracle(entry: string, args: string[] = [], cwd?: string): Promise<RunResult> {
  // The entry is made absolute because the run may happen in another working directory.
  return run(
    "node",
    ["--import", TSX_LOADER, resolve(entry), ...args],
    RUN_TIMEOUT_MS,
    ORACLE_ENV,
    cwd,
  );
}

export interface Divergence {
  kind: "stdout" | "stderr" | "exit" | "files" | "opt-verify" | "crash" | "hang" | "infra";
  detail: string;
}

// Run the differential check on in-memory source (writes it to a temp .ts first). Used by the
// fuzzer, where programs are generated rather than stored as fixtures.
export async function differentialSource(source: string, tag = "gen"): Promise<Divergence[]> {
  const dir = mkdtempSync(join(tmpdir(), "chadv2-src-"));
  const path = join(dir, `${tag}.ts`);
  writeFileSync(path, source);
  return differential(path);
}

// Compiles + runs the fixture every way and returns any divergences (empty = all agree). IR is
// emitted once, then -O0 and -O2 link concurrently while the Node oracle runs in parallel.
export async function differential(
  fixturePath: string,
  args: string[] = [],
): Promise<Divergence[]> {
  const dir = mkdtempSync(join(tmpdir(), "chadv2-diff-"));
  const loaded = loadProgram(fixturePath);
  validate(loaded);

  const irPath = join(dir, "out.ll");
  const binO0 = join(dir, "o0");
  const binO2 = join(dir, "o2");
  writeFileSync(irPath, emitIr(loaded));

  // One directory per run: the three run concurrently and their file effects are compared
  // afterwards, so they must neither share nor race on a working directory.
  const seed = join(dirname(fixturePath), "fixtures");
  const runDirs = [join(dir, "cwd-node"), join(dir, "cwd-o0"), join(dir, "cwd-o2")] as const;
  const [cwdNode, cwdO0, cwdO2] = runDirs.map((d) => prepareRunDir(d, seed)) as [
    string,
    string,
    string,
  ];
  const cwds = [...runDirs, cwdNode, cwdO0, cwdO2];

  const objs = runtimeObjects(); // warm the runtime .o cache once (avoids a concurrent race)
  // The same arguments go to node and to the binary: `process.argv.slice(2)` is identical for
  // both, which is exactly why only that slice is in the subset.
  const oraclePromise = runOracle(fixturePath, args, cwdNode); // oracle runs while we compile
  await Promise.all([linkIr(irPath, binO0, "0", objs), linkIr(irPath, binO2, "2", objs)]);

  const [oracle, o0, o2] = await Promise.all([
    oraclePromise,
    run(binO0, args, RUN_TIMEOUT_MS, process.env, cwdO0),
    run(binO2, args, RUN_TIMEOUT_MS, process.env, cwdO2),
  ]);

  const out: Divergence[] = [];
  // An abnormal oracle (Node crashed or hung) means the fixture itself is broken, not the compiler
  // — surface it as infra rather than silently diffing against garbage.
  if (oracle.signal || oracle.timedOut) {
    out.push({
      kind: "infra",
      detail: `node oracle ended abnormally (signal=${oracle.signal}, timedOut=${oracle.timedOut})`,
    });
  }
  const oracleStdout = normalizeCwd(oracle.stdout, cwds);
  const oracleStderr = normalizeCwd(oracle.stderr, cwds);
  const oracleTree = snapshotTree(cwdNode);
  for (const [label, r, cwd] of [
    ["native-O0", o0, cwdO0],
    ["native-O2", o2, cwdO2],
  ] as const) {
    // A crash or hang is ALWAYS a divergence — never fall through to exit-code comparison, where a
    // signal death (reported as no exit code) could otherwise be mistaken for agreement.
    if (r.timedOut) {
      out.push({ kind: "hang", detail: `${label} timed out after ${RUN_TIMEOUT_MS}ms` });
      continue;
    }
    if (r.signal) {
      out.push({ kind: "crash", detail: `${label} crashed with signal ${r.signal}` });
      continue;
    }
    const stdout = normalizeCwd(r.stdout, cwds);
    if (stdout !== oracleStdout) {
      out.push({
        kind: "stdout",
        detail: `${label} stdout ${JSON.stringify(stdout)} != node ${JSON.stringify(oracleStdout)}`,
      });
    }
    const stderrDiff = compareStderr(oracleStderr, normalizeCwd(r.stderr, cwds), oracle.exit);
    if (stderrDiff !== null) out.push({ kind: "stderr", detail: `${label} ${stderrDiff}` });
    if (r.exit !== oracle.exit) {
      out.push({ kind: "exit", detail: `${label} exit ${r.exit} != node ${oracle.exit}` });
    }
    const treeDiff = diffTrees(oracleTree, snapshotTree(cwd));
    if (treeDiff !== null) out.push({ kind: "files", detail: `${label} ${treeDiff}` });
  }

  try {
    await execFileAsync(OPT, ["-passes=verify", "-disable-output", irPath]);
  } catch (e) {
    out.push({ kind: "opt-verify", detail: `opt -verify failed: ${(e as Error).message}` });
  }

  return out;
}
