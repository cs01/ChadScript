// Discovery runs of the Value-union fuzzer (the suite tests/slow/union-fuzz.test.ts runs a fixed
// 20-seed corpus). Each program is checked against Node at -O0/-O2 + IR verify; a divergence is
// written to .fuzz/union-fail-<seed>.ts as a ready-made repro.
//
//   bun run scripts/union-fuzz.ts --count 200 --seed 1

import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { genUnionProgram } from "../tests/harness/union-gen.js";
import { differentialSource } from "../tests/harness/differential.js";

function argValue(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
}

const count = argValue("--count", 200);
const baseSeed = argValue("--seed", 1);
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", ".fuzz");
mkdirSync(outDir, { recursive: true });

let failures = 0;
for (let i = 0; i < count; i++) {
  const seed = baseSeed + i;
  const program = genUnionProgram(seed);
  let divergences;
  try {
    divergences = await differentialSource(program, `ufuzz${seed}`);
  } catch (e) {
    divergences = [{ kind: "error" as const, detail: (e as Error).message }];
  }
  if (divergences.length > 0) {
    failures++;
    const path = join(outDir, `union-fail-${seed}.ts`);
    writeFileSync(path, program);
    process.stdout.write(
      `FAIL seed ${seed} -> ${path}\n${divergences.map((d) => `  [${d.kind}] ${d.detail.split("\n")[0]}`).join("\n")}\n`,
    );
  }
  if ((i + 1) % 50 === 0) process.stdout.write(`  ${i + 1}/${count} (${failures} fail)\n`);
}

process.stdout.write(`\n${count} programs, ${failures} divergence(s).\n`);
process.exit(failures > 0 ? 1 : 0);
