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

export interface RunResult {
  stdout: string;
  exit: number;
}

async function run(cmd: string, args: string[]): Promise<RunResult> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { encoding: "utf8" });
    return { stdout, exit: 0 };
  } catch (e) {
    const err = e as { stdout?: Buffer | string; code?: number | string };
    const exit = typeof err.code === "number" ? err.code : 1;
    return { stdout: (err.stdout ?? "").toString(), exit };
  }
}

export interface Divergence {
  kind: "stdout" | "exit" | "opt-verify";
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
  for (const [label, r] of [
    ["native-O0", o0],
    ["native-O2", o2],
  ] as const) {
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
