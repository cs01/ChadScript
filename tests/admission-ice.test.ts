// Admission-ICE ratchet report. The constitution's "Definition of Ready" requires that admitted
// programs cannot intentionally reach a lowering/codegen ICE — every out-of-subset construct must
// fail closed at validate with a CS#### diagnostic, never slip through to the backend. This is the
// checked report of that ratchet: a corpus of tsc-clean, out-of-subset snippets, each asserted to
// be rejected by validate() (not by tsc, and not by an ICE). If any entry ever becomes admitted,
// this test fails — a signal to either implement it properly (with a differential fixture) or add
// the missing rejection. The `code` documents which rule owns each hole.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "../src/pipeline.js";

interface Case {
  name: string;
  code: string; // the CS#### the subset validator must report
  src: string;
}

// Each snippet is tsc-clean (so a rejection here is the SUBSET's, not a type error) but outside the
// accepted subset. Grouped by the rule that gates it.
const CORPUS: Case[] = [
  // Permanent / later-phase syntax.
  { name: "regex literal", code: "CS1213", src: `const r = /a+/;\nconsole.log(r.source);\n` },
  { name: "bigint literal", code: "CS1000", src: `const b = 10n;\nconsole.log(b);\n` },
  // JSON.stringify is IN the subset (codegen json.ts); only the parser side is still rejected.
  { name: "JSON.parse", code: "CS1214", src: `const o = JSON.parse("{}");\nconsole.log(o);\n` },
  { name: "new Date", code: "CS1215", src: `const d = new Date();\nconsole.log(d);\n` },
  // `Date.now()` is IN the subset (runtime/time.c); the rest of the static surface is not.
  { name: "Date.parse", code: "CS1215", src: `console.log(Date.parse("2020-01-01"));\n` },

  // UTF-16-vs-UTF-8 gated operations.
  {
    name: "charCodeAt",
    code: "CS1216",
    src: `const s: string = "a";\nconsole.log(s.charCodeAt(0));\n`,
  },
  {
    name: "string <",
    code: "CS1216",
    src: `const a: string = "a";\nconst b: string = "b";\nconsole.log(a < b);\n`,
  },
  { name: "string index", code: "CS1216", src: `const s: string = "ab";\nconsole.log(s[0]);\n` },
  {
    name: "string for-of",
    code: "CS1216",
    src: `const s: string = "ab";\nfor (const c of s) console.log(c);\n`,
  },
  { name: "String.fromCharCode", code: "CS1216", src: `console.log(String.fromCharCode(65));\n` },

  // Language forms awaiting implementation.
  {
    name: "default param",
    code: "CS1217",
    src: `function f(x: number = 1): number { return x; }\nconsole.log(f());\n`,
  },
  {
    name: "optional param",
    code: "CS1217",
    src: `function f(x?: number): number { return x ?? 0; }\nconsole.log(f());\n`,
  },
  { name: "uninitialized let", code: "CS1218", src: `let x: number;\nx = 1;\nconsole.log(x);\n` },
  {
    name: "mutable capture",
    code: "CS1219",
    src: `let c = 0;\nconst f = () => { c = c + 1; };\nf();\nconsole.log(c);\n`,
  },

  // Unsupported stdlib surface.
  { name: "Array.from", code: "CS1220", src: `console.log(Array.from([1]));\n` },
  // isInteger/isFinite/isNaN ARE supported; parseFloat is the still-unsupported Number static.
  { name: "Number.parseFloat", code: "CS1220", src: `console.log(Number.parseFloat("1"));\n` },
  {
    name: "Object.assign",
    code: "CS1220",
    src: `console.log(Object.assign({ a: 1 }, { b: 2 }));\n`,
  },
  { name: "Math.hypot", code: "CS1220", src: `console.log(Math.hypot(3, 4));\n` },
  { name: "number.toFixed", code: "CS1221", src: `console.log((1.5).toFixed(2));\n` },
  {
    name: "map.forEach",
    code: "CS1222",
    src: `const m = new Map<string, number>();\nm.forEach((v) => console.log(v));\n`,
  },
  {
    name: "set.forEach",
    code: "CS1222",
    src: `const s = new Set<number>([1]);\ns.forEach((v) => console.log(v));\n`,
  },
  {
    name: "string.normalize",
    code: "CS1223",
    src: `const s: string = "a";\nconsole.log(s.normalize());\n`,
  },
  { name: "array.fill", code: "CS1224", src: `console.log([1, 2].fill(0));\n` },
  {
    name: "array.splice",
    code: "CS1224",
    src: `const a = [1, 2, 3];\nconsole.log(a.splice(1, 1));\n`,
  },
  {
    name: "object method call",
    code: "CS1225",
    src: `type T = { f: () => number };\nconst o: T = { f: () => 1 };\nconsole.log(o.f());\n`,
  },

  // Combinations — an out-of-subset construct nested inside otherwise-valid code must still reject.
  {
    name: "unsupported method in a loop",
    code: "CS1224",
    src: `const a = [1, 2, 3];\nfor (let i = 0; i < 1; i++) a.fill(0);\nconsole.log(a);\n`,
  },
  {
    name: "gated op inside a class method",
    code: "CS1216",
    src: `class C { cmp(a: string, b: string): boolean { return a < b; } }\nconsole.log(new C().cmp("a", "b"));\n`,
  },
];

let dir: string;
function fileFor(c: Case): string {
  dir ??= mkdtempSync(join(tmpdir(), "chadv2-admission-"));
  const p = join(dir, `${c.name.replace(/[^a-z0-9]+/gi, "_")}.ts`);
  writeFileSync(p, c.src);
  return p;
}

for (const c of CORPUS) {
  test(`admission-ice: ${c.name} rejects at validate (${c.code})`, () => {
    const r = check(fileFor(c));
    assert.equal(
      r.accepted,
      false,
      `admitted an out-of-subset construct (would reach codegen): ${c.name}`,
    );
    const codes = r.diagnostics.map((d) => d.code);
    assert.ok(
      codes.includes(c.code),
      `expected ${c.code} for "${c.name}", got: ${codes.join(", ") || "(none)"}`,
    );
  });
}
