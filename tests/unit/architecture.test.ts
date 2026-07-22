// The type wall, enforced mechanically. The whole rewrite exists because v1's type/codegen
// boundary was a convention that eroded. Here it is a test: the backend (codegen/) and the IR
// (hir/, ir/) must NEVER import `typescript`. Only frontend/, validate/, and lower/ may.
//
// If this test fails, a change reached the checker from inside the backend — do NOT relax the
// test; move the type decision into lower/ and stamp the answer onto an HIR node instead.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

// Directories that must be free of any dependency on the TypeScript compiler.
const CHECKER_FREE_DIRS = ["codegen", "hir", "ir"];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

const IMPORTS_TS = /\bfrom\s+["']typescript["']|\brequire\(["']typescript["']\)/;

for (const dir of CHECKER_FREE_DIRS) {
  test(`src/${dir}/ does not import typescript`, () => {
    for (const file of tsFiles(join(srcRoot, dir))) {
      const text = readFileSync(file, "utf8");
      assert.ok(
        !IMPORTS_TS.test(text),
        `${file} imports "typescript" — the backend must not touch the checker. ` +
          `Move the type decision into lower/ and record it on an HIR node.`,
      );
    }
  });
}
