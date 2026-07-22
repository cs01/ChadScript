// Standalone differential fuzzer for discovery runs (the suite `tests/fuzz.test.ts` only runs a
// small fixed-seed corpus for CI). Generates random programs over the accepted subset, checks
// each against Node at -O0/-O2 + IR verify, and on divergence prints the program and writes it
// to .fuzz/fail-<seed>.ts for a minimal repro.
//
//   bun run scripts/fuzz.ts --count 500 --seed 1
//   bun run scripts/fuzz.ts --count 2000 --seed 42

import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { genProgram } from "../tests/harness/fuzz-gen.js";
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
  const program = genProgram(seed);
  let divergences;
  try {
    divergences = differentialSource(program, `fuzz${seed}`);
  } catch (e) {
    divergences = [{ kind: "error" as const, detail: (e as Error).message }];
  }
  if (divergences.length > 0) {
    failures++;
    const path = join(outDir, `fail-${seed}.ts`);
    writeFileSync(path, program);
    process.stdout.write(
      `\nFAIL seed ${seed} → ${path}\n${divergences.map((d) => `  [${d.kind}] ${d.detail}`).join("\n")}\n` +
        `--- program ---\n${program}\n`,
    );
  }
  if ((i + 1) % 50 === 0) process.stdout.write(`  ${i + 1}/${count} (${failures} fail)\n`);
}

process.stdout.write(`\n${count} programs, ${failures} divergence(s).\n`);
process.exit(failures > 0 ? 1 : 0);
