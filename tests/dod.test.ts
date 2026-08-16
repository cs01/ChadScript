// Validates the definition-of-done manifest against reality, so "are we at the stopping point?"
// is a test result rather than a judgment call.
//
// What it proves:
//   1. every cited fixture EXISTS on disk;
//   2. every cited fixture is actually DISCOVERED by the suite that would run it (a fixture the
//      harness never picks up proves nothing);
//   3. run/ evidence is a differential fixture and reject/ evidence is a rejection fixture —
//      citing one where the other belongs is a category error, not a passing item;
//   4. a `done` item cites at least one piece of evidence, and a `todo`/`deferred` item cites
//      NONE (so progress cannot accrue silently — someone must flip the status on purpose);
//   5. ids are unique and non-done items explain themselves.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { discoverFixtures } from "./harness/discover.js";
import { DOD } from "./dod-manifest.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(here, "fixtures");
const runRoot = join(fixturesRoot, "run");
const rejectRoot = join(fixturesRoot, "reject");

// The exact sets the differential and rejection suites iterate — not a directory listing, so a
// fixture the harness skips (an unreachable module file, say) cannot be cited as evidence.
const discovered = new Map<string, { expectReject: string | null }>();
for (const [root, fixtures] of [
  [runRoot, discoverFixtures(runRoot)],
  [rejectRoot, discoverFixtures(rejectRoot)],
] as const) {
  const prefix = relative(fixturesRoot, root);
  for (const fx of fixtures) {
    discovered.set(join(prefix, relative(root, fx.path)), { expectReject: fx.expectReject });
  }
}

test("dod manifest: ids are unique", () => {
  const seen = new Set<string>();
  const dupes = DOD.filter((i) => (seen.has(i.id) ? true : (seen.add(i.id), false))).map(
    (i) => i.id,
  );
  assert.deepEqual(dupes, [], `duplicate definition-of-done ids: ${dupes.join(", ")}`);
});

for (const item of DOD) {
  test(`dod [${item.status}] ${item.id}`, () => {
    if (item.status === "done") {
      assert.ok(
        item.evidence.length > 0,
        `${item.id} is marked done but cites no evidence — a done item must name the fixtures that prove it`,
      );
    } else {
      assert.deepEqual(
        item.evidence,
        [],
        `${item.id} is ${item.status} but cites evidence; flip it to "done" if the evidence is real`,
      );
      assert.ok(
        item.note && item.note.length > 0,
        `${item.id} is ${item.status} and must carry a note saying what is missing`,
      );
    }

    for (const ev of item.evidence) {
      assert.ok(
        ev.startsWith("run/") || ev.startsWith("reject/"),
        `${item.id}: evidence "${ev}" must start with run/ or reject/`,
      );
      assert.ok(
        existsSync(join(fixturesRoot, ev)),
        `${item.id}: evidence fixture does not exist: tests/fixtures/${ev}`,
      );
      const found = discovered.get(ev);
      assert.ok(
        found,
        `${item.id}: evidence tests/fixtures/${ev} exists but no suite discovers it, so it proves nothing`,
      );
      if (ev.startsWith("run/")) {
        assert.equal(
          found.expectReject,
          null,
          `${item.id}: ${ev} is a rejection fixture but is cited as run/ evidence`,
        );
      } else {
        assert.ok(
          found.expectReject,
          `${item.id}: ${ev} is under reject/ but has no @expect-reject annotation`,
        );
      }
    }
  });
}

test("dod summary", () => {
  const by = (s: string) => DOD.filter((i) => i.status === s);
  const done = by("done");
  const todo = by("todo");
  const deferred = by("deferred");
  const pct = Math.round((done.length / DOD.length) * 100);
  console.log(
    `\n  definition of done: ${done.length}/${DOD.length} items (${pct}%)` +
      `\n  remaining: ${[...todo, ...deferred].map((i) => i.id).join(", ") || "none"}\n`,
  );
  // Not an assertion on the count — this test reports; the per-item tests above are the gate.
  assert.ok(DOD.length > 0);
});
