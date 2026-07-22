// Differential harness: the default proof of correctness. For a fixture, we compare the
// native binary's behavior against Node running the same source, at BOTH -O0 and -O2:
//   - node source            (the oracle)
//   - native -O0             (must equal oracle)
//   - native -O2             (must equal oracle → O0==O2, else an -O2 UB leak)
// and we run `opt -passes=verify` on the emitted IR. Any mismatch is a failure.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProgram } from "../../src/frontend/program.js";
import { validate } from "../../src/validate/validate.js";
import { emitIr, linkIr, runtimeObjects } from "../../src/driver/build.js";
import { OPT } from "../../src/driver/toolchain.js";

const execFileAsync = promisify(execFile);

// A fixture that runs longer than this is treated as a hang (subset programs finish in ms). Kept
// generous so a slow CI box doesn't false-positive.
export const RUN_TIMEOUT_MS = 20_000;

export interface RunResult {
  stdout: string;
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
): Promise<RunResult> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { encoding: "utf8", timeout: timeoutMs });
    return { stdout, exit: 0, signal: null, timedOut: false };
  } catch (e) {
    const err = e as {
      stdout?: Buffer | string;
      code?: number | string;
      signal?: string | null;
      killed?: boolean;
    };
    // execFile sets `killed` when IT terminated the child — here that only happens on timeout.
    const timedOut = err.killed === true;
    const signal = !timedOut && typeof err.signal === "string" ? err.signal : null;
    const exit = typeof err.code === "number" ? err.code : null;
    return { stdout: (err.stdout ?? "").toString(), exit, signal, timedOut };
  }
}

export interface Divergence {
  kind: "stdout" | "exit" | "opt-verify" | "crash" | "hang" | "infra";
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
export async function differential(fixturePath: string): Promise<Divergence[]> {
  const dir = mkdtempSync(join(tmpdir(), "chadv2-diff-"));
  const loaded = loadProgram(fixturePath);
  validate(loaded);

  const irPath = join(dir, "out.ll");
  const binO0 = join(dir, "o0");
  const binO2 = join(dir, "o2");
  writeFileSync(irPath, emitIr(loaded));

  const objs = runtimeObjects(); // warm the runtime .o cache once (avoids a concurrent race)
  const oraclePromise = run("node", [fixturePath]); // oracle runs while we compile
  await Promise.all([linkIr(irPath, binO0, "0", objs), linkIr(irPath, binO2, "2", objs)]);

  const [oracle, o0, o2] = await Promise.all([oraclePromise, run(binO0, []), run(binO2, [])]);

  const out: Divergence[] = [];
  // An abnormal oracle (Node crashed or hung) means the fixture itself is broken, not the compiler
  // — surface it as infra rather than silently diffing against garbage.
  if (oracle.signal || oracle.timedOut) {
    out.push({
      kind: "infra",
      detail: `node oracle ended abnormally (signal=${oracle.signal}, timedOut=${oracle.timedOut})`,
    });
  }
  for (const [label, r] of [
    ["native-O0", o0],
    ["native-O2", o2],
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
    if (r.stdout !== oracle.stdout) {
      out.push({
        kind: "stdout",
        detail: `${label} stdout ${JSON.stringify(r.stdout)} != node ${JSON.stringify(oracle.stdout)}`,
      });
    }
    if (r.exit !== oracle.exit) {
      out.push({ kind: "exit", detail: `${label} exit ${r.exit} != node ${oracle.exit}` });
    }
  }

  try {
    await execFileAsync(OPT, ["-passes=verify", "-disable-output", irPath]);
  } catch (e) {
    out.push({ kind: "opt-verify", detail: `opt -verify failed: ${(e as Error).message}` });
  }

  return out;
}
