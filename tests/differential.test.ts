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
import { discoverFixtures } from "./harness/discover.js";
import { differential } from "./harness/differential.js";

const here = dirname(fileURLToPath(import.meta.url));
const runRoot = join(here, "fixtures", "run");

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

test("differential suite (all fixtures vs Node, O0 + O2)", async () => {
  const fixtures = [...discoverFixtures(runRoot)];
  const failures: string[] = [];
  await pool(fixtures, Math.max(2, cpus().length), async (fx) => {
    const divergences = await differential(fx.path, fx.args);
    if (divergences.length > 0) {
      const name = relative(runRoot, fx.path);
      failures.push(
        `${name}:\n    ${divergences.map((d) => `[${d.kind}] ${d.detail}`).join("\n    ")}`,
      );
    }
  });
  assert.equal(failures.length, 0, `\n${failures.join("\n")}`);
});
