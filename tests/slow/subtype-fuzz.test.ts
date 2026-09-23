// Structural-subtyping fuzz: programs where classes and literals with reordered and extra fields
// flow through interfaces, read and written through each view (tests/harness/subtype-gen.ts).
//
// KNOWN_BUG: the current value model lays objects out by static type, so most seeds miscompile
// (wrong output, pointer bits printed as numbers, silent crashes). Until phase 3 (shaped objects)
// this test asserts the fuzzer still DETECTS that, which proves the gate can fail. Phase 3 flips
// KNOWN_BUG to false and every seed must match Node.

import { test } from "node:test";
import assert from "node:assert/strict";
import { genSubtypeProgram } from "../harness/subtype-gen.js";
import { differentialSource, type Divergence } from "../harness/differential.js";

const KNOWN_BUG = true;
const SEED_COUNT = 20;

test("structural-subtyping fuzz vs Node", { timeout: 600_000 }, async () => {
  const results = await Promise.all(
    Array.from({ length: SEED_COUNT }, async (_, i) => {
      const seed = i + 1;
      const program = genSubtypeProgram(seed);
      let divergences: Divergence[];
      try {
        divergences = await differentialSource(program, `subtype${seed}`);
      } catch (e) {
        divergences = [
          { kind: "infra", detail: `compile: ${(e as Error).message.split("\n")[0]}` },
        ];
      }
      return { seed, program, divergences };
    }),
  );
  const bad = results.filter((r) => r.divergences.length > 0);
  if (KNOWN_BUG) {
    // Count only real miscompiles: a generator or harness breakage (infra) must not keep this
    // gate green by accident.
    const miscompiled = bad.filter((r) => r.divergences.some((d) => d.kind !== "infra"));
    assert.ok(
      miscompiled.length > 0,
      "no seed diverged: the layout bug looks fixed, set KNOWN_BUG = false",
    );
    return;
  }
  assert.equal(
    bad.length,
    0,
    bad
      .map(
        (r) =>
          `seed ${r.seed}:\n${r.divergences.map((d) => `  [${d.kind}] ${d.detail}`).join("\n")}\n--- program ---\n${r.program}`,
      )
      .join("\n"),
  );
});
