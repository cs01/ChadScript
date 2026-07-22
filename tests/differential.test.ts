// Differential suite: every accepted fixture under fixtures/run/ must behave identically to
// Node, at -O0 and -O2, with verifiable IR. This is the primary correctness gate.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { discoverFixtures } from "./harness/discover.js";
import { differential } from "./harness/differential.js";

const here = dirname(fileURLToPath(import.meta.url));
const runRoot = join(here, "fixtures", "run");

for (const fx of discoverFixtures(runRoot)) {
  const name = relative(runRoot, fx.path);
  test(`differential ${name}`, async () => {
    const divergences = await differential(fx.path);
    assert.equal(
      divergences.length,
      0,
      `diverged from Node:\n  ${divergences.map((d) => `[${d.kind}] ${d.detail}`).join("\n  ")}`,
    );
  });
}
