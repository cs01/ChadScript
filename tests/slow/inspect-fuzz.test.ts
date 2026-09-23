// console.log fuzz: random nested arrays, objects, class instances, Maps, Sets and strings
// (tests/harness/inspect-gen.ts) printed and diffed against Node at -O0 and -O2, because Node's
// util.inspect layout (runtime/inspect.milo) is fiddly. The fixed seeds are the CI corpus;
// `bun run scripts/inspect-fuzz.ts --count 300` hunts with more.

import { test } from "node:test";
import assert from "node:assert/strict";
import { genInspectProgram } from "../harness/inspect-gen.js";
import { differentialSource, type Divergence } from "../harness/differential.js";

const SEED_COUNT = 20;

test("console.log inspect fuzz vs Node", { timeout: 600_000 }, async () => {
  const results = await Promise.all(
    Array.from({ length: SEED_COUNT }, async (_, i) => {
      const seed = i + 1;
      const program = genInspectProgram(seed);
      let divergences: Divergence[];
      try {
        divergences = await differentialSource(program, `inspect${seed}`);
      } catch (e) {
        // Every generated program is in the subset by construction, so a rejection is a finding.
        divergences = [
          { kind: "infra", detail: `compile: ${(e as Error).message.split("\n")[0]}` },
        ];
      }
      return { seed, program, divergences };
    }),
  );
  const bad = results.filter((r) => r.divergences.length > 0);
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
