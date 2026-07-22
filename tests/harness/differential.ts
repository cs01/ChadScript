// Differential harness: the default proof of correctness. For a fixture, we compare the
// native binary's behavior against Node running the same source, at BOTH -O0 and -O2:
//   - node source            (the oracle)
//   - native -O0             (must equal oracle)
//   - native -O2             (must equal oracle → O0==O2, else an -O2 UB leak)
// and we run `opt -passes=verify` on the emitted IR. Any mismatch is a failure.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProgram } from "../../src/frontend/program.js";
import { validate } from "../../src/validate/validate.js";
import { build } from "../../src/driver/build.js";
import { OPT } from "../../src/driver/toolchain.js";

export interface RunResult {
  stdout: string;
  exit: number;
}

function run(cmd: string, args: string[]): RunResult {
  try {
    const stdout = execFileSync(cmd, args, { encoding: "utf8" });
    return { stdout, exit: 0 };
  } catch (e) {
    const err = e as { stdout?: Buffer | string; status?: number };
    return { stdout: (err.stdout ?? "").toString(), exit: err.status ?? 1 };
  }
}

export interface Divergence {
  kind: "stdout" | "exit" | "opt-verify";
  detail: string;
}

// Run the differential check on in-memory source (writes it to a temp .ts first). Used by the
// fuzzer, where programs are generated rather than stored as fixtures.
export function differentialSource(source: string, tag = "gen"): Divergence[] {
  const dir = mkdtempSync(join(tmpdir(), "chadv2-src-"));
  const path = join(dir, `${tag}.ts`);
  writeFileSync(path, source);
  return differential(path);
}

// Compiles + runs the fixture every way and returns any divergences (empty = all agree).
export function differential(fixturePath: string): Divergence[] {
  const dir = mkdtempSync(join(tmpdir(), "chadv2-diff-"));
  const loaded = loadProgram(fixturePath);
  validate(loaded);

  const irPath = join(dir, "out.ll");
  const binO0 = join(dir, "o0");
  const binO2 = join(dir, "o2");
  build(loaded, { outPath: binO0, opt: "0", emitIrTo: irPath });
  build(loaded, { outPath: binO2, opt: "2" });

  const oracle = run("node", [fixturePath]);
  const o0 = run(binO0, []);
  const o2 = run(binO2, []);

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
    execFileSync(OPT, ["-passes=verify", "-disable-output", irPath], { stdio: "pipe" });
  } catch (e) {
    out.push({ kind: "opt-verify", detail: `opt -verify failed: ${(e as Error).message}` });
  }

  return out;
}
