// Compiler file-size ratchet (review directive #4 / Definition-of-Ready: "compiler file-size
// ratchets prevent the dispatch centers from regrowing unchecked"). No source file may exceed
// LIMIT lines, except the two dispatch centers the review flagged — each pinned to a ceiling it may
// only SHRINK below. Splitting lowering/codegen into bounded modules lowers these ceilings; when a
// pinned file drops under LIMIT, its entry is deleted (the test enforces that too). A NEW oversized
// file, or growth of a pinned one, fails here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const LIMIT = 800;

// Temporary ceilings for files over LIMIT today. RATCHET: lower these as the files shrink; never
// raise them. Delete an entry once its file is under LIMIT.
const ALLOWLIST: Record<string, number> = {
  "src/lower/lower.ts": 1790,
  "src/codegen/expr.ts": 902,
};

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (e.endsWith(".ts")) yield full;
  }
}

function lineCount(path: string): number {
  return readFileSync(path, "utf8").split("\n").length;
}

test("no source file exceeds its size ceiling", () => {
  const repoRoot = join(srcRoot, "..");
  const violations: string[] = [];
  for (const path of walk(srcRoot)) {
    const rel = relative(repoRoot, path);
    const ceiling = ALLOWLIST[rel] ?? LIMIT;
    const n = lineCount(path);
    if (n > ceiling) violations.push(`${rel}: ${n} lines > ${ceiling} ceiling`);
  }
  assert.equal(violations.length, 0, `\n${violations.join("\n")}`);
});

test("allowlist has no stale entries (delete once a file is under LIMIT)", () => {
  const repoRoot = join(srcRoot, "..");
  const stale: string[] = [];
  for (const [rel, ceiling] of Object.entries(ALLOWLIST)) {
    const n = lineCount(join(repoRoot, rel));
    if (n <= LIMIT) stale.push(`${rel}: ${n} ≤ ${LIMIT} — remove from ALLOWLIST`);
    // A ceiling far above actual should be tightened toward actual (keeps the ratchet meaningful).
    else if (n < ceiling)
      stale.push(`${rel}: ${n} < ${ceiling} ceiling — lower the ceiling to ${n}`);
  }
  assert.equal(stale.length, 0, `\n${stale.join("\n")}`);
});
