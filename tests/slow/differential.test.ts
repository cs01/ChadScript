// Differential suite: every accepted fixture under fixtures/run/ must behave identically to
// Node, at -O0 and -O2, with verifiable IR. This is the primary correctness gate.
//
// Fixtures run through a bounded concurrency pool (each already compiles O0/O2 concurrently), so
// the whole suite is one test rather than 250+ sequential ones — the wall-clock bottleneck was
// per-fixture serialization, not the work itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { cpus } from "node:os";
import { discoverFixtures } from "../harness/discover.js";
import { differential } from "../harness/differential.js";

const here = dirname(fileURLToPath(import.meta.url));
const runRoot = join(here, "..", "fixtures", "run");
// examples/ are user-facing showcases; running them here keeps them from rotting.
const exampleRoot = join(here, "..", "..", "examples");
// CHAD_FIXTURE=<substring> narrows the suite to matching fixture paths (the dev-loop filter;
// bun's -t cannot select inside this single pooled test).
const only = process.env["CHAD_FIXTURE"];

// Run `fn` over `items` with at most `concurrency` in flight (each item spawns clang + node
// processes, so we cap parallelism near the core count rather than launching all at once).
async function pool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

// One pooled test for the whole suite, so it gets its own budget instead of bun's per-test
// --timeout (the suite outgrew 60 s on a laptop and failed as a timeout, not a divergence).
test("differential suite (all fixtures vs Node, O0 + O2)", { timeout: 900_000 }, async () => {
  const fixtures = [...discoverFixtures(runRoot), ...discoverFixtures(exampleRoot)].filter(
    (fx) => only === undefined || fx.path.includes(only),
  );
  // A filter typo or a discovery regression must not pass as "0 checked".
  assert.ok(fixtures.length > 0, `no fixtures matched${only ? ` CHAD_FIXTURE=${only}` : ""}`);
  const failures: string[] = [];
  await pool(fixtures, Math.max(2, cpus().length), async (fx) => {
    const divergences = await differential(fx.path, fx.args);
    if (divergences.length > 0) {
      const name = relative(join(here, "..", ".."), fx.path);
      failures.push(
        `${name}:\n    ${divergences.map((d) => `[${d.kind}] ${d.detail}`).join("\n    ")}`,
      );
    }
  });
  assert.equal(failures.length, 0, `\n${failures.join("\n")}`);
});
