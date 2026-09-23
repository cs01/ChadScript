// The runtime is Milo; C is only for what Milo cannot express (PLAN.md "Runtime language: Milo").
// These pin that: the C residue stays under its 100-line budget, and the Milo compiler pin that
// the driver, the setup script and CI all read is well formed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { miloPin } from "../../src/driver/toolchain.js";

const runtimeDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "runtime");

test("C residue in runtime/ stays under 100 lines of code", () => {
  const cFiles = readdirSync(runtimeDir).filter((f) => f.endsWith(".c") || f.endsWith(".h"));
  let code = 0;
  for (const f of cFiles) {
    for (const line of readFileSync(join(runtimeDir, f), "utf8").split("\n")) {
      const t = line.trim();
      if (t !== "" && !t.startsWith("//")) code++;
    }
  }
  assert.ok(code > 0, "no C found: residue.c (GC_INIT, marker globals) must exist");
  assert.ok(code < 100, `runtime C residue is ${code} lines of code; the budget is under 100`);
});

test("the Milo pin is a full commit sha", () => {
  assert.match(miloPin(), /^[0-9a-f]{40}$/);
});
