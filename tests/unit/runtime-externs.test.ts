// Every runtime entry a lowering table can emit must be DECLARED by codegen, or the program
// fails at `clang` with "use of undefined value @cs_..." — a link-time error for what is really
// a table that drifted. This test closes that gap: it reads the externs out of real emitted IR
// (not a regex over codegen.ts source) and asserts each table's entries are present.
//
// The `declare` set is emitted unconditionally at the top of generate(), so any program's IR
// carries the full list; a trivial one keeps this fast.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProgram } from "../../src/frontend/program.js";
import { validate } from "../../src/validate/validate.js";
import { emitIr } from "../../src/driver/build.js";
import { FS_ENTRIES } from "../../src/lower/node-fs.js";
import { PATH_ENTRIES } from "../../src/lower/node-path.js";

function declaredExterns(): Set<string> {
  const dir = mkdtempSync(join(tmpdir(), "chadv2-externs-"));
  const src = join(dir, "trivial.ts");
  writeFileSync(src, 'console.log("x");\n');
  const loaded = loadProgram(src);
  validate(loaded);
  const ir = emitIr(loaded);
  const names = new Set<string>();
  for (const m of ir.matchAll(/^declare\s+\S+\s+@([A-Za-z0-9_]+)\(/gm)) names.add(m[1]!);
  return names;
}

const declared = declaredExterns();

test("codegen declares every extern the runtime-module lowering tables emit", () => {
  assert.ok(declared.size > 0, "no externs parsed out of emitted IR — the parse is wrong");
  const missing: string[] = [];
  for (const [table, entries] of [
    ["node:fs", FS_ENTRIES],
    ["node:path", PATH_ENTRIES],
  ] as const) {
    for (const [name, { entry }] of Object.entries(entries)) {
      if (!declared.has(entry)) missing.push(`${table}.${name} → ${entry}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `lowering emits calls to undeclared runtime entries (add mod.declareExtern in codegen.ts):\n  ${missing.join("\n  ")}`,
  );
});
