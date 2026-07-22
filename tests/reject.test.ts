// Rejection suite: every fixture annotated `@expect-reject: CSxxxx` must be rejected by the
// compiler front half with a diagnostic carrying that exact code. This is how each validator
// rule proves it fires — no rule ships without a fixture here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { check } from "../src/pipeline.js";
import { discoverFixtures } from "./harness/discover.js";

const here = dirname(fileURLToPath(import.meta.url));
const rejectRoot = join(here, "fixtures", "reject");

for (const fx of discoverFixtures(rejectRoot)) {
  if (!fx.expectReject) {
    // A file under fixtures/reject/ without the annotation is a mistake — fail loudly.
    test(`reject/${relative(rejectRoot, fx.path)} missing @expect-reject`, () => {
      assert.fail(`fixture under reject/ has no @expect-reject annotation: ${fx.path}`);
    });
    continue;
  }
  const name = relative(rejectRoot, fx.path);
  test(`reject ${name} → ${fx.expectReject}`, () => {
    const result = check(fx.path);
    assert.equal(result.accepted, false, `expected rejection but program was accepted: ${name}`);
    const codes = result.diagnostics.map((d) => d.code);
    assert.ok(
      codes.includes(fx.expectReject!),
      `expected code ${fx.expectReject} for ${name}, got: ${codes.join(", ") || "(none)"}`,
    );
  });
}
