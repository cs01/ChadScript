// The effects oracle compares what a program leaves on disk and writes to stderr. These tests pin
// that each comparison actually FAILS when it should: a tree diff that stops seeing a file, or a
// stderr normalizer that swallows everything, would report agreement forever.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compareStderr,
  diffTrees,
  normalizeCwd,
  prepareRunDir,
  snapshotTree,
  uncaughtErrorLines,
} from "../harness/effects.js";

function tree(files: Record<string, string | null>): string {
  const root = mkdtempSync(join(tmpdir(), "chad-tree-"));
  for (const [rel, body] of Object.entries(files)) {
    if (body === null) mkdirSync(join(root, rel), { recursive: true });
    else {
      mkdirSync(join(root, rel, ".."), { recursive: true });
      writeFileSync(join(root, rel), body);
    }
  }
  return root;
}

test("identical trees have no diff", () => {
  const files = { "a.txt": "x", "out/b.json": "{}", empty: null };
  assert.equal(diffTrees(snapshotTree(tree(files)), snapshotTree(tree(files))), null);
});

test("a file only one side wrote is reported", () => {
  const d = diffTrees(snapshotTree(tree({ "a.txt": "x" })), snapshotTree(tree({})));
  assert.equal(d, "a.txt: node has file (1 bytes), native has missing");
  const e = diffTrees(snapshotTree(tree({})), snapshotTree(tree({ "extra.log": "" })));
  assert.equal(e, "extra.log: node has missing, native has file (0 bytes)");
});

test("differing bytes are reported with a preview", () => {
  const d = diffTrees(
    snapshotTree(tree({ "out.csv": "a,b\n" })),
    snapshotTree(tree({ "out.csv": "a,c\n" })),
  );
  assert.match(d ?? "", /^out\.csv: contents differ: node "a,b\\n" != native "a,c\\n"$/);
});

test("the first differing path in sorted order is the one reported", () => {
  const d = diffTrees(
    snapshotTree(tree({ "a.txt": "1", "b/c.txt": "2", "z.txt": "3" })),
    snapshotTree(tree({ "a.txt": "1", "b/c.txt": "X", "z.txt": "Y" })),
  );
  assert.match(d ?? "", /^b\/c\.txt: /);
});

test("an empty directory is an effect; file vs directory is a kind mismatch", () => {
  assert.equal(
    diffTrees(snapshotTree(tree({ out: null })), snapshotTree(tree({}))),
    "out: node has directory, native has missing",
  );
  assert.equal(
    diffTrees(snapshotTree(tree({ out: null })), snapshotTree(tree({ out: "" }))),
    "out: node has directory, native has file (0 bytes)",
  );
});

test("symlinks are compared by target, not followed", () => {
  const a = tree({ "t.txt": "x" });
  const b = tree({ "t.txt": "x" });
  symlinkSync("t.txt", join(a, "link"));
  symlinkSync("other.txt", join(b, "link"));
  assert.equal(
    diffTrees(snapshotTree(a), snapshotTree(b)),
    "link: node has symlink -> t.txt, native has symlink -> other.txt",
  );
});

test("run dirs are seeded with a private copy of fixtures/", () => {
  const seed = tree({ "in.csv": "1,2\n" });
  const base = mkdtempSync(join(tmpdir(), "chad-run-"));
  const r1 = prepareRunDir(join(base, "one"), seed);
  const r2 = prepareRunDir(join(base, "two"), seed);
  writeFileSync(join(r1, "fixtures", "in.csv"), "changed");
  const d = diffTrees(snapshotTree(r2), snapshotTree(r1));
  assert.match(d ?? "", /^fixtures\/in\.csv: contents differ/);
  // No seed directory: an empty cwd.
  assert.equal(snapshotTree(prepareRunDir(join(base, "three"), join(base, "nope"))).size, 0);
});

test("cwd paths normalize to a placeholder, longest spelling first", () => {
  assert.equal(
    normalizeCwd("at /private/var/t/cwd-o0/x and /var/t/cwd-o0", [
      "/var/t/cwd-o0",
      "/private/var/t/cwd-o0",
    ]),
    "at <cwd>/x and <cwd>",
  );
});

const NODE_UNCAUGHT = `/abs/path/prog.ts:3
  throw new Error("boom");
  ^

Error: boom
    at main (/abs/path/prog.ts:3:9)
    at node:internal/main:1:1

Node.js v25.3.0
`;

test("an uncaught error compares only its first line", () => {
  assert.deepEqual(uncaughtErrorLines(NODE_UNCAUGHT), ["Error: boom"]);
  assert.equal(compareStderr(NODE_UNCAUGHT, "Error: boom\n", 1), null);
  assert.match(compareStderr(NODE_UNCAUGHT, "Error: bang\n", 1) ?? "", /uncaught error/);
  assert.notEqual(compareStderr(NODE_UNCAUGHT, "", 1), null);
});

test("stderr the program wrote before the uncaught error is still compared", () => {
  const node = `warn: first\n${NODE_UNCAUGHT}`;
  assert.deepEqual(uncaughtErrorLines(node), ["warn: first", "Error: boom"]);
  assert.equal(compareStderr(node, "warn: first\nError: boom\n", 1), null);
  assert.notEqual(compareStderr(node, "Error: boom\n", 1), null);
});

test("a thrown string (no source excerpt of the program) still yields its first line", () => {
  const node = `\nnode:internal/modules/run_main:107\n    triggerUncaughtException(\n    ^\nstr thrown\n(Use \`node --trace-uncaught ...\` to show where the exception was thrown)\n`;
  assert.deepEqual(uncaughtErrorLines(node), ["str thrown"]);
});

test("without an uncaught error, stderr is compared exactly", () => {
  assert.equal(compareStderr("usage: x\n", "usage: x\n", 2), null);
  assert.notEqual(compareStderr("usage: x\n", "usage: x", 2), null);
  assert.notEqual(compareStderr("", "noise\n", 0), null);
  // A caret line in ordinary output does not relax the comparison when the exit was clean.
  assert.notEqual(compareStderr("a\nb\n^\n\nc\n", "c\n", 0), null);
});
