// Fuzz suite: a fixed set of seeds generates programs across the whole accepted operator
// surface, each differentially checked against Node (stdout + exit + IR verify) at -O0 and -O2.
// Fixed seeds keep CI deterministic and act as a regression corpus; the standalone
// `scripts/fuzz.ts` runs larger random batches for discovery.
//
// A failure prints the exact generated program — a ready-made minimal repro.

import { test } from "node:test";
import assert from "node:assert/strict";
import { genProgram } from "./harness/fuzz-gen.js";
import { differentialSource } from "./harness/differential.js";

const SEED_COUNT = 25;

for (let seed = 1; seed <= SEED_COUNT; seed++) {
  test(`fuzz seed ${seed}`, () => {
    const program = genProgram(seed);
    const divergences = differentialSource(program, `fuzz${seed}`);
    assert.equal(
      divergences.length,
      0,
      `seed ${seed} diverged from Node:\n${divergences
        .map((d) => `  [${d.kind}] ${d.detail}`)
        .join("\n")}\n--- program ---\n${program}`,
    );
  });
}
