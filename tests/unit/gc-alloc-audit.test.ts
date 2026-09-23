// Every heap allocation must go through the allocator API (runtime/gc.milo cs_alloc / gcAlloc*,
// src/codegen/alloc.ts), because the collector traces the heap through the layout header that API
// writes. A raw allocation elsewhere would produce an object with no header, which the collector
// would misread. This pins that no other file calls an allocator directly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function files(dir: string, ext: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...files(full, ext));
    else if (ext.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

const RAW_GC = /\bGC_[a-z_]*malloc\w*|\bGC_add_roots\b|@cs_gc_alloc\b/;

test("no raw GC allocation outside the allocator module", () => {
  const allowed = new Set(["runtime/gc.milo"]);
  const offenders = [
    ...files(join(repo, "runtime"), [".milo", ".c", ".h"]),
    ...files(join(repo, "src"), [".ts"]),
  ]
    .map((f) => relative(repo, f))
    .filter((f) => !allowed.has(f))
    .filter((f) => RAW_GC.test(readFileSync(join(repo, f), "utf8")));
  assert.deepEqual(offenders, [], "allocate through cs_alloc / gcAlloc* (runtime/gc.milo)");
});

test("the audit pattern still matches what it is meant to reject", () => {
  // A gate whose pattern silently stops matching passes forever; prove it still bites.
  for (const s of ["GC_malloc(16)", "GC_malloc_atomic(n)", "GC_add_roots(a, b)", "@cs_gc_alloc"]) {
    assert.ok(RAW_GC.test(s), s);
  }
});
